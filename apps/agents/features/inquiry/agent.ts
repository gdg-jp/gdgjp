import { type LanguageModel, type ModelMessage, ToolLoopAgent, stepCountIs } from "ai";
import { type ConnpassTools, createConnpassTools } from "../connpass/tools";
import { agentTelemetry } from "../telemetry/telemetry";
import {
  type FetchLike,
  WIKI_INDEX_PATH,
  type WikiChapter,
  type WikiTools,
  createWikiSession,
  createWikiTools,
} from "../wiki/tools";
import { type AgentEnv, defaultAgentModel, defaultEnv } from "./model";
/** Enough steps for index → ls → cat → follow-ups without collapsing into one-shot RAG. */
export const AGENT_MAX_STEPS = 12;

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
