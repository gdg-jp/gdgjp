import { createHash } from "node:crypto";
import { type LanguageModel, generateObject } from "ai";
import { z } from "zod";

import { type AgentEnv, type InquiryOutcome, defaultAgentModel } from "./agent";
import {
  type ChatPlatform,
  type LinkAccountDeps,
  getLinkedToken,
  linkAccountDepsFromEnv,
} from "./link-account";
import { type LinkRedis, createLinkRedis, filingKey, getRedis } from "./redis";
import { getVerifiedMessageId } from "./request-context";
import type { FetchLike } from "./tools/wiki";
import { fetchFilingInstructions, postLogEntry, postNote } from "./wiki-write";

const MIN_ANSWER_CHARS = 200;
const MIN_CITED_PATHS = 2;
const FILING_TTL_SECONDS = 86_400;
const FALLBACK_TTL_SECONDS = 600;

const FilingDecisionSchema = z.object({
  file: z.boolean(),
  reason: z.string(),
  slug: z.string().optional(),
  title: z.string().optional(),
  summary: z.string().optional(),
  content: z.string().optional(),
  replacePath: z.string().optional(),
});

export type FilingDecision = z.infer<typeof FilingDecisionSchema>;

export type FilingPassInput = {
  platform: ChatPlatform;
  chatUserId: string;
  spaceId?: string;
  question: string;
  outcome: InquiryOutcome;
  /** Optional explicit id when ALS is unavailable (tests / raw fallback). */
  messageId?: string;
};

export type FilingPassDeps = {
  link?: LinkAccountDeps;
  env?: AgentEnv;
  fetch?: FetchLike;
  model?: LanguageModel;
  redis?: LinkRedis;
  generateObject?: typeof generateObject;
};

const FILING_PROMPT = `You decide whether a Chat Wiki answer should be filed as a reusable answer page.

file: false is the expected common answer. Only file when the answer is a reusable synthesis —
a comparison, recommendation, or procedure drawn from several pages — and is not already fully
covered by one of the cited pages. A single-fact lookup must return file: false.

When file is true, provide slug (kebab-case), title, summary (one or two sentences), and content
(markdown ≤8000 chars) that cites the paths you were given. If one of the cited paths is already
an answers/* page that this answer should replace, set replacePath to that workspace path.

Never invent paths. Never include personal contact details, credentials, or named incident parties.`;

type AnswerSteps = Extract<InquiryOutcome, { kind: "answer" }>["steps"];

/**
 * Collect workspace paths that wiki_cat / wiki_search actually returned.
 * Model-invented paths in the answer text are never cited this way.
 */
export function extractCitedPathsFromSteps(steps: AnswerSteps): string[] {
  const paths = new Set<string>();
  for (const step of steps) {
    for (const tr of step.toolResults) {
      const toolName = "toolName" in tr ? String(tr.toolName) : "";
      const output = tr.output;
      if (!output || typeof output !== "object") continue;

      if (toolName === "wiki_cat" && "path" in output && typeof output.path === "string") {
        if (output.path !== "/wiki/index") paths.add(output.path);
        continue;
      }
      if (toolName === "wiki_search" && "matches" in output && Array.isArray(output.matches)) {
        for (const match of output.matches) {
          if (
            match &&
            typeof match === "object" &&
            "path" in match &&
            typeof match.path === "string"
          ) {
            paths.add(match.path);
          }
        }
      }
    }
  }
  return [...paths];
}

function toolResultsNeedRelink(steps: AnswerSteps): boolean {
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

function defaultEnv(env: NodeJS.ProcessEnv = process.env): AgentEnv {
  return {
    WIKI_API_URL: env.WIKI_API_URL ?? "https://wiki.gdgs.jp",
    WIKI_PUBLIC_URL: env.WIKI_PUBLIC_URL,
    ACCOUNTS_URL: env.ACCOUNTS_URL ?? "https://accounts.gdgs.jp",
    GOOGLE_VERTEX_API_KEY: env.GOOGLE_VERTEX_API_KEY,
    AGENT_MODEL: env.AGENT_MODEL,
  };
}

function resolveMessageId(input: FilingPassInput): { id: string; ttl: number } {
  const fromAls = getVerifiedMessageId();
  if (fromAls) return { id: fromAls, ttl: FILING_TTL_SECONDS };
  if (input.messageId) return { id: input.messageId, ttl: FILING_TTL_SECONDS };

  const hash = createHash("sha256")
    .update(`${input.platform}:${input.chatUserId}:${input.question}`)
    .digest("hex")
    .slice(0, 32);
  return { id: `fallback:${hash}`, ttl: FALLBACK_TTL_SECONDS };
}

function truncateSubject(question: string): string {
  return question.replace(/\r?\n/g, " ").trim().slice(0, 200);
}

/**
 * Background filing pass. Failures are swallowed — the Chat reply already went out.
 */
export async function runFilingPass(
  input: FilingPassInput,
  deps: FilingPassDeps = {},
): Promise<void> {
  try {
    await runFilingPassInner(input, deps);
  } catch {
    // Bookkeeping only — never surface in Chat.
  }
}

async function runFilingPassInner(input: FilingPassInput, deps: FilingPassDeps): Promise<void> {
  const redis = deps.redis ?? createLinkRedis(getRedis());
  const { id: messageId, ttl } = resolveMessageId(input);
  const acquired = await redis.setNX(filingKey(input.platform, messageId), "1", ttl);
  if (!acquired) return;

  const outcome = input.outcome;
  if (outcome.kind !== "answer") return;

  const citedPaths = extractCitedPathsFromSteps(outcome.steps);
  const generate = deps.generateObject ?? generateObject;
  const env = deps.env ?? defaultEnv();
  const linkDeps = deps.link ?? linkAccountDepsFromEnv(process.env, { fetch: deps.fetch });

  const token = await getLinkedToken(input.platform, input.chatUserId, linkDeps, {
    spaceId: input.spaceId,
  });
  if (token.status !== "ok") return;

  const writeCtx = {
    accessToken: token.accessToken,
    wikiApiUrl: env.WIKI_API_URL,
    fetch: deps.fetch,
  };

  const gateOk =
    !toolResultsNeedRelink(outcome.steps) &&
    citedPaths.length >= MIN_CITED_PATHS &&
    outcome.text.trim().length >= MIN_ANSWER_CHARS;

  let filedPath: string | undefined;
  let skipReason: string | undefined;

  if (!gateOk) {
    skipReason =
      citedPaths.length < MIN_CITED_PATHS
        ? "fewer than two cited paths"
        : outcome.text.trim().length < MIN_ANSWER_CHARS
          ? "answer too short"
          : "gate failed";
  } else {
    const instructions = await fetchFilingInstructions(writeCtx);
    if (!instructions.ok) {
      skipReason = "Needs action: filing rules unavailable";
    } else {
      // Avoid constructing the real Vertex model when tests inject generateObject.
      const model =
        deps.model ?? (deps.generateObject ? ({} as LanguageModel) : defaultAgentModel(env));
      const decision = await generate({
        model,
        schema: FilingDecisionSchema,
        system: `${instructions.instructions.content}\n\n${FILING_PROMPT}`,
        prompt: JSON.stringify({
          question: input.question,
          answer: outcome.text,
          citedPaths,
        }),
      });

      const value = decision.object;
      if (!value.file) {
        skipReason = value.reason || "model chose not to file";
      } else if (!value.slug || !value.title || !value.summary || !value.content) {
        skipReason = "incomplete filing payload";
      } else {
        const replaceId =
          value.replacePath && citedPaths.includes(value.replacePath)
            ? value.replacePath
            : undefined;
        const note = await postNote(writeCtx, {
          slug: value.slug,
          title: value.title,
          summary: value.summary,
          content: value.content,
          citedPaths,
          ...(replaceId ? { replaceId } : {}),
        });
        if (note.ok) {
          filedPath = note.body.path;
        } else if (note.status === 409 && note.error === "slug_exists") {
          skipReason = `slug exists${note.path ? ` (${note.path})` : ""}`;
        } else if (
          note.error === "citations_span_access" ||
          note.error === "citations_span_chapters" ||
          note.error === "chapter_ambiguous" ||
          note.error === "invalid_citation" ||
          note.error === "forbidden_chapter"
        ) {
          skipReason = note.error;
        } else {
          skipReason = `note write failed (${note.error})`;
        }
      }
    }
  }

  const lines = [
    ...citedPaths.slice(0, 6).map((path) => `Cited ${path}`),
    filedPath ? `Filed ${filedPath}` : skipReason ? `Not filed: ${skipReason}` : "Not filed",
  ];

  await postLogEntry(writeCtx, {
    subject: truncateSubject(input.question) || "query",
    lines,
  });
}
