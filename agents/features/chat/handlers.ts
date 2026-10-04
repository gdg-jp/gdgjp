import type { ModelMessage } from "ai";
import type { Message, Thread } from "chat";
import { toAiMessages } from "chat/ai";
import { createLinkAuthorizationUrl } from "../auth/authorization";
import type { ChatPlatform, LinkAccountDeps } from "../auth/contracts";
import { linkAccountDepsFromEnv } from "../auth/environment";
import { unlinkAccount } from "../auth/tokens";
import { runFilingPass } from "../filing/filing";
import { type HandleInquiryDeps, handleInquiry } from "../inquiry/inquiry";
import { defaultEnv } from "../inquiry/model";
import type { InquiryOutcome } from "../inquiry/outcome";
import { emitInquiryScores, inquiryJudgeMetadata } from "../telemetry/scores";
import { type InquirySpan, observeInquiry } from "../telemetry/telemetry";
import type { FetchLike } from "../wiki/tools";
import type { AgentsChat, ChatPlatformAdapter } from "./adapters";
import {
  DISCORD_POST_TIMEOUT_MS,
  DISCORD_RESPONSE_TIMEOUT_MS,
  DISCORD_UNAVAILABLE_MESSAGE,
  withResponseDeadline,
} from "./deadline";
import { ASK_COMMAND, LOGIN_COMMAND } from "./discord-commands";
export function loginPrompt(authorizationUrl: string, isGuild: boolean): string {
  if (isGuild) {
    return `Open this link to connect your Discord account to GDG Accounts. The first person to link in this server shares Wiki access with everyone else in it:\n${authorizationUrl}`;
  }
  return `Open this link to connect your Discord account to GDG Accounts:\n${authorizationUrl}`;
}

/** Extract Discord guild id from a slash-command interaction payload (absent for DMs). */
export function discordGuildId(raw: unknown): string | undefined {
  if (raw && typeof raw === "object" && "guild_id" in raw) {
    const value = (raw as { guild_id?: unknown }).guild_id;
    return typeof value === "string" && value ? value : undefined;
  }
  return undefined;
}

export function adapterNameToPlatform(adapterName: string): ChatPlatform | null {
  if (adapterName === "gchat") return "google-chat";
  if (adapterName === "discord") return "discord";
  return null;
}

export function isUnlinkCommandText(text: string): boolean {
  return /^\/unlink(?:@\S+)?(?:\s|$)/i.test(text.trim());
}

export async function handleUnlink(
  platform: ChatPlatform,
  chatUserId: string,
  deps: { link?: LinkAccountDeps; fetch?: FetchLike } = {},
): Promise<string> {
  const linkDeps = deps.link ?? linkAccountDepsFromEnv(process.env, { fetch: deps.fetch });
  const result = await unlinkAccount(platform, chatUserId, linkDeps);
  if (result.revoked) {
    return "Your Chat account has been unlinked from GDG Accounts. Ask a question to get a new linking URL.";
  }
  return "No linked account was found (or unlink could not complete). You can link again when you ask a question.";
}

function updateInquirySpanFromOutcome(
  span: InquirySpan,
  outcome: InquiryOutcome,
  judgeMeta?: Record<string, unknown>,
): void {
  const attributes: Parameters<InquirySpan["update"]>[0] = {
    output: outcome.text,
    ...(judgeMeta ? { metadata: judgeMeta } : {}),
  };
  if (outcome.kind === "temporarily_unavailable") {
    attributes.level = "WARNING";
    attributes.statusMessage = "account linking temporarily unavailable";
  } else if (outcome.kind === "needs_relink") {
    attributes.level = "WARNING";
    attributes.statusMessage = "wiki link expired or revoked";
  }
  span.update(attributes);
}

async function completeInquiryTurn(input: {
  span: InquirySpan;
  platform: ChatPlatform;
  chatUserId: string;
  spaceId?: string;
  question: string;
  outcome: InquiryOutcome;
  postReply: (text: string) => Promise<unknown>;
  deps: HandleInquiryDeps;
}): Promise<void> {
  const judgeMeta = inquiryJudgeMetadata(input.outcome);
  updateInquirySpanFromOutcome(input.span, input.outcome, judgeMeta);
  await input.postReply(input.outcome.text);
  await emitInquiryScores(input.outcome);
  await runFilingPass(
    {
      platform: input.platform,
      chatUserId: input.chatUserId,
      spaceId: input.spaceId,
      question: input.question,
      outcome: input.outcome,
    },
    input.deps,
  );
}

let handlersRegistered = new WeakSet<AgentsChat>();

/**
 * Idempotent Chat SDK handler registration for Wiki Q&A.
 * Discord answers only through slash commands; Google Chat keeps mention/DM triggers.
 */
export function registerAgentHandlers(
  bot: AgentsChat,
  adapter: ChatPlatformAdapter,
  deps: HandleInquiryDeps = {},
): void {
  if (handlersRegistered.has(bot)) return;
  handlersRegistered.add(bot);

  const reply = async (thread: Thread, message: Message) => {
    const platform = adapterNameToPlatform(thread.adapter.name);
    if (!platform) {
      await thread.post("Unsupported chat platform.");
      return;
    }
    const chatUserId = message.author.userId;
    if (message.author.isBot === true || message.author.isMe) return;

    if (isUnlinkCommandText(message.text)) {
      const text = await handleUnlink(platform, chatUserId, {
        link: deps.link,
        fetch: deps.fetch,
      });
      await thread.post(text);
      return;
    }

    await thread.subscribe();

    const history: Message[] = [];
    for await (const msg of thread.allMessages) {
      history.push(msg);
      if (history.length >= 40) break;
    }
    const aiMessages = await toAiMessages(history.reverse());
    const env = deps.env ?? defaultEnv();

    await observeInquiry(
      {
        platform,
        chatUserId,
        spaceId: thread.id,
        sessionScopeId: thread.id,
        model: env.AGENT_MODEL?.trim() || "gemini-2.5-flash",
      },
      async (span) => {
        span.update({ input: message.text });
        const outcome = await handleInquiry(
          {
            platform,
            chatUserId,
            spaceId: thread.id,
            messages: aiMessages as ModelMessage[],
          },
          deps,
        );
        await completeInquiryTurn({
          span,
          platform,
          chatUserId,
          spaceId: thread.id,
          question: message.text,
          outcome,
          postReply: (text) => thread.post(text),
          deps,
        });
      },
    );
  };

  // Discord: slash commands only — no Gateway Message Content Intent for mentions/DMs.
  if (adapter === "gchat") {
    bot.onNewMention(reply);
    bot.onSubscribedMessage(reply);
    bot.onDirectMessage(reply);
  }

  bot.onSlashCommand(ASK_COMMAND, async (event) => {
    const respond = (text: string) =>
      withResponseDeadline(event.channel.post(text), DISCORD_POST_TIMEOUT_MS);
    const platform = adapterNameToPlatform(event.adapter.name);
    if (!platform) {
      await respond("Unsupported chat platform.");
      return;
    }
    const chatUserId = event.user.userId;
    const guildId = discordGuildId(event.raw);
    const channelId = event.channel.id;
    const env = deps.env ?? defaultEnv();

    try {
      await observeInquiry(
        {
          platform,
          chatUserId,
          spaceId: guildId,
          sessionScopeId: channelId,
          model: env.AGENT_MODEL?.trim() || "gemini-2.5-flash",
        },
        async (span) => {
          span.update({ input: event.text });
          const abortSignal = AbortSignal.timeout(DISCORD_RESPONSE_TIMEOUT_MS);
          const outcome = await withResponseDeadline(
            handleInquiry(
              {
                platform,
                chatUserId,
                spaceId: guildId,
                prompt: event.text,
                abortSignal,
              },
              deps,
            ),
          );
          await completeInquiryTurn({
            span,
            platform,
            chatUserId,
            spaceId: guildId,
            question: event.text,
            outcome,
            postReply: respond,
            deps,
          });
        },
      );
    } catch (error) {
      // Discord has already received a deferred interaction response. Never let
      // an exception (or Vercel's impending timeout) leave it as "thinking".
      console.error("[agents] Discord /ask failed:", error);
      try {
        await respond(DISCORD_UNAVAILABLE_MESSAGE);
      } catch (postError) {
        console.error("[agents] Failed to resolve Discord /ask interaction:", postError);
      }
    }
  });

  bot.onSlashCommand(LOGIN_COMMAND, async (event) => {
    const respond = (text: string) =>
      withResponseDeadline(event.channel.post(text), DISCORD_POST_TIMEOUT_MS);
    const platform = adapterNameToPlatform(event.adapter.name);
    if (!platform) {
      await respond("Unsupported chat platform.");
      return;
    }
    try {
      const text = await withResponseDeadline(
        (async () => {
          const linkDeps = deps.link ?? linkAccountDepsFromEnv(process.env, { fetch: deps.fetch });
          const guildId = discordGuildId(event.raw);
          const authorizationUrl = await createLinkAuthorizationUrl(
            {
              platform,
              chatUserId: event.user.userId,
              spaceId: guildId,
            },
            linkDeps,
          );
          return loginPrompt(authorizationUrl, Boolean(guildId));
        })(),
      );
      await respond(text);
    } catch (error) {
      console.error("[agents] Discord /login failed:", error);
      try {
        await respond(DISCORD_UNAVAILABLE_MESSAGE);
      } catch (postError) {
        console.error("[agents] Failed to resolve Discord /login interaction:", postError);
      }
    }
  });
}

/** Test-only: allow re-registering handlers. */
export function resetAgentHandlersForTests(): void {
  handlersRegistered = new WeakSet<AgentsChat>();
}
