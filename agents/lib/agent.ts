import { createVertex } from "@ai-sdk/google-vertex";
import type { LanguageModelV3 } from "@ai-sdk/provider";
import { CHAPTERS_CLAIM } from "@gdgjp/gdg-lib/auth/claims";
import { type LanguageModel, type ModelMessage, ToolLoopAgent, stepCountIs } from "ai";
import type { Message, Thread } from "chat";
import { toAiMessages } from "chat/ai";

import type { AgentsChat, ChatPlatformAdapter } from "./adapters";
import { ASK_COMMAND, LOGIN_COMMAND } from "./discord-commands";
import { runFilingPass } from "./filing";
import {
  type ChatPlatform,
  type LinkAccountDeps,
  createLinkAuthorizationUrl,
  getLinkedToken,
  linkAccountDepsFromEnv,
  unlinkAccount,
} from "./link-account";
import { emitInquiryScores, inquiryJudgeMetadata } from "./scores";
import { type InquirySpan, agentTelemetry, observeInquiry } from "./telemetry";
import { type ConnpassTools, createConnpassTools } from "./tools/connpass";
import {
  type FetchLike,
  type WikiChapter,
  type WikiTools,
  createWikiSession,
  createWikiTools,
} from "./tools/wiki";

export const WIKI_INDEX_PATH = "/wiki/index";

/** Enough steps for index → ls → cat → follow-ups without collapsing into one-shot RAG. */
export const AGENT_MAX_STEPS = 12;

/**
 * Leave enough time to replace Discord's deferred "thinking" response before
 * Vercel's 300 s function limit can terminate the background task.
 */
export const DISCORD_RESPONSE_TIMEOUT_MS = 240_000;
export const DISCORD_POST_TIMEOUT_MS = 10_000;
export const DISCORD_UNAVAILABLE_MESSAGE =
  "I couldn't complete that request right now. Please try again in a moment.";

export class ResponseDeadlineExceededError extends Error {
  constructor() {
    super("discord_response_deadline_exceeded");
    this.name = "ResponseDeadlineExceededError";
  }
}

/** Bound background work so a deferred Discord interaction is always resolved. */
export function withResponseDeadline<T>(
  operation: Promise<T>,
  timeoutMs = DISCORD_RESPONSE_TIMEOUT_MS,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new ResponseDeadlineExceededError()), timeoutMs);
    void operation.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export const SYSTEM_INSTRUCTIONS = `You are the GDG Japan Wiki assistant in Google Chat / Discord.

Query is exploration, not retrieval. Navigate the Wiki the way a coding agent navigates a codebase:
1. Always wiki_cat path ${WIKI_INDEX_PATH} first. It is a type router (which namespace to open), not a full page listing.
2. Pick one namespace from the router, then wiki_cat that namespace page or wiki_ls it (entries include summaries) to get the type catalog.
3. Use wiki_search only when the tree does not obviously contain the answer; scope with path when the type is known.
4. wiki_cat paths must be copied verbatim from wiki_ls / wiki_search results (or ${WIKI_INDEX_PATH} / the namespace paths it names).
5. When a tool returns nextCursor, continue only if you still need more — never drain the whole page automatically.
6. A 404 means not found or not visible. Say so; do not retry that path or probe neighbours.
7. If a tool returns needsRelink, tell the user their link expired and they must link again — do not invent an answer.
8. Cite every Wiki page you used with its pageUrl (markdown links). An answer without citations is not usable.
9. If exploration finds nothing relevant, say the Wiki does not have an answer and offer to register a source with wiki_add_source. Do not answer from your own knowledge about venues, people, budgets, or chapter operations.
10. For wiki_add_source: if the user has multiple chapters and has not chosen one, ask in Chat first. Never send chapter __all__ unless the user explicitly chose all chapters.

Connpass admin tools (connpass_*) are available when the user asks to create/list/publish events on allowlisted chapter groups. Writes are async jobs — poll with connpass_get_job. Only chapter organizers (or admins) can write.

Keep answers concise and operational. Japanese or English to match the user.`;

export type AgentEnv = {
  WIKI_API_URL: string;
  WIKI_PUBLIC_URL?: string;
  CONNPASS_API_URL?: string;
  ACCOUNTS_URL: string;
  GOOGLE_VERTEX_API_KEY?: string;
  AGENT_MODEL?: string;
};

export type AgentTools = WikiTools & ConnpassTools;

export type RunWikiAgentInput = {
  accessToken: string;
  chapters: readonly WikiChapter[];
  prompt?: string;
  messages?: ModelMessage[];
  model?: LanguageModel;
  fetch?: FetchLike;
  env?: AgentEnv;
  stopWhenSteps?: number;
  abortSignal?: AbortSignal;
};

export type WikiAgentGenerateResult = Awaited<
  ReturnType<ToolLoopAgent<never, AgentTools>["generate"]>
>;

export type RunWikiAgentResult = {
  text: string;
  tools: AgentTools;
  session: ReturnType<typeof createWikiSession>;
  steps: WikiAgentGenerateResult["steps"];
};

function defaultEnv(env: NodeJS.ProcessEnv = process.env): AgentEnv {
  return {
    WIKI_API_URL: env.WIKI_API_URL ?? "https://wiki.gdgs.jp",
    WIKI_PUBLIC_URL: env.WIKI_PUBLIC_URL,
    CONNPASS_API_URL: env.CONNPASS_API_URL ?? "https://connpass.gdgs.jp",
    ACCOUNTS_URL: env.ACCOUNTS_URL ?? "https://accounts.gdgs.jp",
    GOOGLE_VERTEX_API_KEY: env.GOOGLE_VERTEX_API_KEY,
    AGENT_MODEL: env.AGENT_MODEL,
  };
}

export function defaultAgentModel(env: AgentEnv = defaultEnv()): LanguageModelV3 {
  const apiKey = env.GOOGLE_VERTEX_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("GOOGLE_VERTEX_API_KEY is required to use the Vertex AI Gemini provider");
  }

  const modelId = env.AGENT_MODEL?.trim() || "gemini-2.5-flash";
  return createVertex({ apiKey })(modelId);
}

export function createWikiAgent(options: {
  tools: AgentTools;
  model?: LanguageModel;
  stopWhenSteps?: number;
  instructions?: string;
  /** Extra AI SDK telemetry metadata (chapter slugs, model id, …). */
  telemetryMetadata?: Record<string, string | number | boolean | string[]>;
}): ToolLoopAgent<never, AgentTools> {
  return new ToolLoopAgent({
    model: options.model ?? defaultAgentModel(),
    instructions: options.instructions ?? SYSTEM_INSTRUCTIONS,
    tools: options.tools,
    stopWhen: stepCountIs(options.stopWhenSteps ?? AGENT_MAX_STEPS),
    experimental_telemetry: agentTelemetry("wiki-agent", options.telemetryMetadata),
  });
}

/** Run the tool loop with a ready access token (tests and handlers). */
export async function runWikiAgent(input: RunWikiAgentInput): Promise<RunWikiAgentResult> {
  const env = input.env ?? defaultEnv();
  const session = createWikiSession();
  const tools: AgentTools = {
    ...createWikiTools({
      accessToken: input.accessToken,
      wikiApiUrl: env.WIKI_API_URL,
      wikiPublicUrl: env.WIKI_PUBLIC_URL ?? env.WIKI_API_URL,
      fetch: input.fetch,
      session,
      chapters: input.chapters,
    }),
    ...createConnpassTools({
      accessToken: input.accessToken,
      connpassApiUrl: env.CONNPASS_API_URL ?? "https://connpass.gdgs.jp",
      fetch: input.fetch,
    }),
  };
  const agent = createWikiAgent({
    tools,
    model: input.model,
    stopWhenSteps: input.stopWhenSteps,
    telemetryMetadata: {
      chapterSlugs: input.chapters.map((c) => c.chapterSlug),
      model: env.AGENT_MODEL?.trim() || "gemini-2.5-flash",
    },
  });

  const result =
    input.messages !== undefined
      ? await agent.generate({ messages: input.messages, abortSignal: input.abortSignal })
      : await agent.generate({ prompt: input.prompt ?? "", abortSignal: input.abortSignal });

  return { text: result.text, tools, session, steps: result.steps };
}

export async function fetchChaptersForToken(
  accessToken: string,
  deps: { accountsUrl: string; fetch?: FetchLike; abortSignal?: AbortSignal },
): Promise<WikiChapter[]> {
  const fetchImpl = deps.fetch ?? fetch;
  const response = await fetchImpl(
    `${deps.accountsUrl.replace(/\/$/, "")}/api/auth/oauth2/userinfo`,
    { headers: { Authorization: `Bearer ${accessToken}` }, signal: deps.abortSignal },
  );
  if (!response.ok) return [];
  const value = (await response.json()) as Record<string, unknown>;
  const raw = value[CHAPTERS_CLAIM];
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const chapter = entry as Record<string, unknown>;
    if (
      (typeof chapter.chapterId === "number" || typeof chapter.chapterId === "string") &&
      typeof chapter.chapterSlug === "string"
    ) {
      return [
        {
          chapterId: String(chapter.chapterId),
          chapterSlug: chapter.chapterSlug,
          role: typeof chapter.role === "string" ? chapter.role : "member",
        },
      ];
    }
    return [];
  });
}

export type InquiryOutcome =
  | { kind: "needs_link"; text: string; authorizationUrl: string }
  | { kind: "temporarily_unavailable"; text: string }
  | { kind: "needs_relink"; text: string; authorizationUrl: string }
  | { kind: "answer"; text: string; steps: RunWikiAgentResult["steps"] };

export type HandleInquiryDeps = {
  link?: LinkAccountDeps;
  env?: AgentEnv;
  fetch?: FetchLike;
  model?: LanguageModel;
  /** Override chapter resolution (tests). */
  chapters?: readonly WikiChapter[];
};

/**
 * Resolve the Chat user's link, then answer. Unlinked users never hit the Wiki API.
 */
export async function handleInquiry(
  input: {
    platform: ChatPlatform;
    chatUserId: string;
    spaceId?: string;
    prompt?: string;
    messages?: RunWikiAgentInput["messages"];
    abortSignal?: AbortSignal;
  },
  deps: HandleInquiryDeps = {},
): Promise<InquiryOutcome> {
  const linkDeps = deps.link ?? linkAccountDepsFromEnv(process.env, { fetch: deps.fetch });
  const env = deps.env ?? defaultEnv();

  const token = await getLinkedToken(input.platform, input.chatUserId, linkDeps, {
    spaceId: input.spaceId,
  });

  if (token.status === "needs_link") {
    return {
      kind: "needs_link",
      authorizationUrl: token.authorizationUrl,
      text: linkPrompt(token.authorizationUrl),
    };
  }
  if (token.status === "temporarily_unavailable") {
    return {
      kind: "temporarily_unavailable",
      text: "Account linking is temporarily unavailable. Please try again in a moment.",
    };
  }

  const chapters =
    deps.chapters ??
    (await fetchChaptersForToken(token.accessToken, {
      accountsUrl: env.ACCOUNTS_URL,
      fetch: deps.fetch ?? linkDeps.fetch,
      abortSignal: input.abortSignal,
    }));

  const result = await runWikiAgent({
    accessToken: token.accessToken,
    chapters,
    prompt: input.prompt,
    messages: input.messages,
    model: deps.model,
    fetch: deps.fetch,
    env,
    abortSignal: input.abortSignal,
  });

  if (toolResultsNeedRelink(result.steps)) {
    const authorizationUrl = await createLinkAuthorizationUrl(
      {
        platform: input.platform,
        chatUserId: input.chatUserId,
        spaceId: input.spaceId,
      },
      linkDeps,
    );
    return {
      kind: "needs_relink",
      authorizationUrl,
      text: relinkPrompt(authorizationUrl),
    };
  }

  return { kind: "answer", text: result.text, steps: result.steps };
}

function toolResultsNeedRelink(steps: RunWikiAgentResult["steps"]): boolean {
  for (const step of steps) {
    for (const tr of step.toolResults) {
      const output = tr.output;
      if (
        output &&
        typeof output === "object" &&
        "needsRelink" in output &&
        (output as { needsRelink?: boolean }).needsRelink === true
      ) {
        return true;
      }
    }
  }
  return false;
}

export function linkPrompt(authorizationUrl: string): string {
  return `Your Chat account is not linked to GDG Accounts yet. Open this link to connect, then ask again:\n${authorizationUrl}`;
}

export function relinkPrompt(authorizationUrl: string): string {
  return `Your Wiki link expired or was revoked. Please link again, then retry:\n${authorizationUrl}`;
}

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

/** True when every cited workspace path appears as a URL or path in the answer. */
export function answerCitesPaths(text: string, paths: readonly string[]): boolean {
  if (paths.length === 0) return true;
  return paths.every((path) => {
    const leaf = path.split("/").filter(Boolean).pop() ?? "";
    return text.includes(path) || (leaf.length > 0 && text.includes(leaf));
  });
}

export { extractCitedPathsFromSteps } from "./filing";
