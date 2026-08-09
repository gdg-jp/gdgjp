import { createVertex } from "@ai-sdk/google-vertex";
import type { LanguageModelV3 } from "@ai-sdk/provider";
import { CHAPTERS_CLAIM } from "@gdgjp/gdg-lib/auth/claims";
import { type LanguageModel, type ModelMessage, ToolLoopAgent, stepCountIs } from "ai";
import type { Message, Thread } from "chat";
import { toAiMessages } from "chat/ai";

import type { AgentsChat, ChatPlatformAdapter } from "./adapters";
import { ASK_COMMAND, LOGIN_COMMAND } from "./discord-commands";
import {
  type ChatPlatform,
  type LinkAccountDeps,
  createLinkAuthorizationUrl,
  getLinkedToken,
  linkAccountDepsFromEnv,
  unlinkAccount,
} from "./link-account";
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

export const SYSTEM_INSTRUCTIONS = `You are the GDG Japan Wiki assistant in Google Chat / Discord.

Query is exploration, not retrieval. Navigate the Wiki the way a coding agent navigates a codebase:
1. Always wiki_cat path ${WIKI_INDEX_PATH} first (the catalog).
2. Prefer wiki_ls to walk namespaces the catalog names.
3. Use wiki_search only when the tree does not obviously contain the answer.
4. wiki_cat paths must be copied verbatim from wiki_ls / wiki_search results (or ${WIKI_INDEX_PATH}).
5. When a tool returns nextCursor, continue only if you still need more — never drain the whole page automatically.
6. A 404 means not found or not visible. Say so; do not retry that path or probe neighbours.
7. If a tool returns needsRelink, tell the user their link expired and they must link again — do not invent an answer.
8. Cite every Wiki page you used with its pageUrl (markdown links). An answer without citations is not usable.
9. If exploration finds nothing relevant, say the Wiki does not have an answer and offer to register a source with wiki_add_source. Do not answer from your own knowledge about venues, people, budgets, or chapter operations.
10. For wiki_add_source: if the user has multiple chapters and has not chosen one, ask in Chat first. Never send chapter __all__ unless the user explicitly chose all chapters.

Keep answers concise and operational. Japanese or English to match the user.`;

export type AgentEnv = {
  WIKI_API_URL: string;
  WIKI_PUBLIC_URL?: string;
  ACCOUNTS_URL: string;
  GOOGLE_VERTEX_API_KEY?: string;
  AGENT_MODEL?: string;
};

export type RunWikiAgentInput = {
  accessToken: string;
  chapters: readonly WikiChapter[];
  prompt?: string;
  messages?: ModelMessage[];
  model?: LanguageModel;
  fetch?: FetchLike;
  env?: AgentEnv;
  stopWhenSteps?: number;
};

export type WikiAgentGenerateResult = Awaited<
  ReturnType<ToolLoopAgent<never, WikiTools>["generate"]>
>;

export type RunWikiAgentResult = {
  text: string;
  tools: WikiTools;
  session: ReturnType<typeof createWikiSession>;
  steps: WikiAgentGenerateResult["steps"];
};

function defaultEnv(env: NodeJS.ProcessEnv = process.env): AgentEnv {
  return {
    WIKI_API_URL: env.WIKI_API_URL ?? "https://wiki.gdgs.jp",
    WIKI_PUBLIC_URL: env.WIKI_PUBLIC_URL,
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
  tools: WikiTools;
  model?: LanguageModel;
  stopWhenSteps?: number;
  instructions?: string;
}): ToolLoopAgent<never, WikiTools> {
  return new ToolLoopAgent({
    model: options.model ?? defaultAgentModel(),
    instructions: options.instructions ?? SYSTEM_INSTRUCTIONS,
    tools: options.tools,
    stopWhen: stepCountIs(options.stopWhenSteps ?? AGENT_MAX_STEPS),
  });
}

/** Run the tool loop with a ready access token (tests and handlers). */
export async function runWikiAgent(input: RunWikiAgentInput): Promise<RunWikiAgentResult> {
  const env = input.env ?? defaultEnv();
  const session = createWikiSession();
  const tools = createWikiTools({
    accessToken: input.accessToken,
    wikiApiUrl: env.WIKI_API_URL,
    wikiPublicUrl: env.WIKI_PUBLIC_URL ?? env.WIKI_API_URL,
    fetch: input.fetch,
    session,
    chapters: input.chapters,
  });
  const agent = createWikiAgent({
    tools,
    model: input.model,
    stopWhenSteps: input.stopWhenSteps,
  });

  const result =
    input.messages !== undefined
      ? await agent.generate({ messages: input.messages })
      : await agent.generate({ prompt: input.prompt ?? "" });

  return { text: result.text, tools, session, steps: result.steps };
}

export async function fetchChaptersForToken(
  accessToken: string,
  deps: { accountsUrl: string; fetch?: FetchLike },
): Promise<WikiChapter[]> {
  const fetchImpl = deps.fetch ?? fetch;
  const response = await fetchImpl(
    `${deps.accountsUrl.replace(/\/$/, "")}/api/auth/oauth2/userinfo`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
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
    }));

  const result = await runWikiAgent({
    accessToken: token.accessToken,
    chapters,
    prompt: input.prompt,
    messages: input.messages,
    model: deps.model,
    fetch: deps.fetch,
    env,
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

    const outcome = await handleInquiry(
      {
        platform,
        chatUserId,
        spaceId: thread.id,
        messages: aiMessages as ModelMessage[],
      },
      deps,
    );
    await thread.post(outcome.text);
  };

  // Discord: slash commands only — no Gateway Message Content Intent for mentions/DMs.
  if (adapter === "gchat") {
    bot.onNewMention(reply);
    bot.onSubscribedMessage(reply);
    bot.onDirectMessage(reply);
  }

  bot.onSlashCommand(ASK_COMMAND, async (event) => {
    const platform = adapterNameToPlatform(event.adapter.name);
    if (!platform) {
      await event.channel.post("Unsupported chat platform.");
      return;
    }
    const outcome = await handleInquiry(
      {
        platform,
        chatUserId: event.user.userId,
        spaceId: discordGuildId(event.raw),
        prompt: event.text,
      },
      deps,
    );
    await event.channel.post(outcome.text);
  });

  bot.onSlashCommand(LOGIN_COMMAND, async (event) => {
    const platform = adapterNameToPlatform(event.adapter.name);
    if (!platform) {
      await event.channel.post("Unsupported chat platform.");
      return;
    }
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
    await event.channel.post(loginPrompt(authorizationUrl, Boolean(guildId)));
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
