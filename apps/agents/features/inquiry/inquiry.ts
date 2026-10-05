import { CHAPTERS_CLAIM } from "@gdgjp/gdg-lib/auth/claims";
import type { LanguageModel } from "ai";
import { createLinkAuthorizationUrl } from "../auth/authorization";
import type { ChatPlatform, LinkAccountDeps } from "../auth/contracts";
import { linkAccountDepsFromEnv } from "../auth/environment";
import { getLinkedToken } from "../auth/tokens";
import type { FetchLike, WikiChapter } from "../wiki/tools";
import { type RunWikiAgentInput, type RunWikiAgentResult, runWikiAgent } from "./agent";
import { type AgentEnv, defaultEnv } from "./model";
import type { InquiryOutcome } from "./outcome";
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
