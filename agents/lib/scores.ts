import type { InquiryOutcome } from "./agent";
import { extractCitedPathsFromSteps } from "./filing";
import { getLangfuseClient, isTelemetryEnabled } from "./telemetry";
import { WIKI_INDEX_PATH } from "./tools/wiki";

const RETRIEVED_PAGES_MAX_CHARS = 12_000;
const WIKI_SLUG_IN_TEXT = /\/wiki\/([A-Za-z0-9_-]+)/g;

/** Mirrors `answerCitesPaths` in agent.ts (avoid scores ↔ agent runtime cycle). */
function citesPaths(text: string, paths: readonly string[]): boolean {
  if (paths.length === 0) return true;
  return paths.every((path) => {
    const leaf = path.split("/").filter(Boolean).pop() ?? "";
    return text.includes(path) || (leaf.length > 0 && text.includes(leaf));
  });
}

export type InquiryScores = {
  outcome_kind: string;
  cited_path_count: number;
  answer_cites_paths: boolean;
  unknown_citation_count: number;
  step_count: number;
  tool_error_count: number;
  index_first: boolean;
  answer_chars: number;
};

type AnswerSteps = Extract<InquiryOutcome, { kind: "answer" }>["steps"];

function toolNameOf(tr: { toolName?: unknown }): string {
  return typeof tr.toolName === "string" ? tr.toolName : "";
}

/** Paths successfully returned by wiki_cat / wiki_search (includes `/wiki/index`). */
export function extractRetrievedPaths(steps: AnswerSteps): string[] {
  const paths = new Set<string>();
  for (const step of steps) {
    for (const tr of step.toolResults) {
      const toolName = toolNameOf(tr);
      const output = tr.output;
      if (!output || typeof output !== "object") continue;
      if ("error" in output) continue;

      if (toolName === "wiki_cat" && "path" in output && typeof output.path === "string") {
        paths.add(output.path);
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

/** Truncated wiki_cat bodies for LLM-as-judge variable mapping. */
export function buildRetrievedPagesSummary(
  steps: AnswerSteps,
  maxChars = RETRIEVED_PAGES_MAX_CHARS,
): string {
  const parts: string[] = [];
  let used = 0;
  for (const step of steps) {
    if (used >= maxChars) break;
    for (const tr of step.toolResults) {
      if (used >= maxChars) break;
      if (toolNameOf(tr) !== "wiki_cat") continue;
      const output = tr.output;
      if (!output || typeof output !== "object" || "error" in output) continue;
      const path = "path" in output && typeof output.path === "string" ? output.path : "";
      const content =
        "content" in output && typeof output.content === "string" ? output.content : "";
      if (!content) continue;
      const chunk = `## ${path}\n${content}`;
      const slice = chunk.slice(0, maxChars - used);
      parts.push(slice);
      used += slice.length;
    }
  }
  return parts.join("\n\n");
}

function leafSlug(path: string): string {
  return path.split("/").filter(Boolean).pop() ?? "";
}

/** Count `/wiki/<slug>` mentions in the answer that were never retrieved from tools. */
export function countUnknownCitations(text: string, retrievedPaths: readonly string[]): number {
  const known = new Set(retrievedPaths.map(leafSlug).filter(Boolean));
  const mentioned = new Set<string>();
  for (const match of text.matchAll(WIKI_SLUG_IN_TEXT)) {
    mentioned.add(match[1]);
  }
  let unknown = 0;
  for (const slug of mentioned) {
    if (!known.has(slug)) unknown += 1;
  }
  return unknown;
}

function firstWikiCatPath(steps: AnswerSteps): string | undefined {
  for (const step of steps) {
    for (const tr of step.toolResults) {
      if (toolNameOf(tr) !== "wiki_cat") continue;
      const input = "input" in tr ? tr.input : undefined;
      if (input && typeof input === "object" && "path" in input && typeof input.path === "string") {
        return input.path;
      }
      const output = tr.output;
      if (
        output &&
        typeof output === "object" &&
        "path" in output &&
        typeof output.path === "string"
      ) {
        return output.path;
      }
    }
  }
  return undefined;
}

function hadIndexRequiredError(steps: AnswerSteps): boolean {
  for (const step of steps) {
    for (const tr of step.toolResults) {
      const output = tr.output;
      if (
        output &&
        typeof output === "object" &&
        "error" in output &&
        (output as { error?: unknown }).error === "index_required"
      ) {
        return true;
      }
    }
  }
  return false;
}

function countToolErrors(steps: AnswerSteps): number {
  let count = 0;
  for (const step of steps) {
    for (const tr of step.toolResults) {
      const output = tr.output;
      if (output && typeof output === "object" && "error" in output) {
        count += 1;
      }
    }
  }
  return count;
}

export function computeInquiryScores(outcome: InquiryOutcome): InquiryScores {
  if (outcome.kind !== "answer") {
    return {
      outcome_kind: outcome.kind,
      cited_path_count: 0,
      answer_cites_paths: true,
      unknown_citation_count: 0,
      step_count: 0,
      tool_error_count: 0,
      index_first: false,
      answer_chars: outcome.text.length,
    };
  }

  const citedPaths = extractCitedPathsFromSteps(outcome.steps);
  const retrievedPaths = extractRetrievedPaths(outcome.steps);
  const firstCat = firstWikiCatPath(outcome.steps);

  return {
    outcome_kind: outcome.kind,
    cited_path_count: citedPaths.length,
    answer_cites_paths: citesPaths(outcome.text, citedPaths),
    unknown_citation_count: countUnknownCitations(outcome.text, retrievedPaths),
    step_count: outcome.steps.length,
    tool_error_count: countToolErrors(outcome.steps),
    index_first: firstCat === WIKI_INDEX_PATH && !hadIndexRequiredError(outcome.steps),
    answer_chars: outcome.text.length,
  };
}

/** Metadata for the root `answer-inquiry` span (online LLM-as-judge variable mapping). */
export function inquiryJudgeMetadata(outcome: InquiryOutcome): Record<string, unknown> | undefined {
  if (outcome.kind !== "answer") return undefined;
  const citedPaths = extractCitedPathsFromSteps(outcome.steps);
  return {
    citedPaths,
    retrievedPages: buildRetrievedPagesSummary(outcome.steps),
  };
}

const INQUIRY_SCORE_SPECS: {
  name: string;
  dataType: "CATEGORICAL" | "NUMERIC" | "BOOLEAN";
  value: (scores: InquiryScores) => string | number;
}[] = [
  { name: "outcome_kind", dataType: "CATEGORICAL", value: (s) => s.outcome_kind },
  { name: "cited_path_count", dataType: "NUMERIC", value: (s) => s.cited_path_count },
  {
    name: "answer_cites_paths",
    dataType: "BOOLEAN",
    value: (s) => (s.answer_cites_paths ? 1 : 0),
  },
  {
    name: "unknown_citation_count",
    dataType: "NUMERIC",
    value: (s) => s.unknown_citation_count,
  },
  { name: "step_count", dataType: "NUMERIC", value: (s) => s.step_count },
  { name: "tool_error_count", dataType: "NUMERIC", value: (s) => s.tool_error_count },
  { name: "index_first", dataType: "BOOLEAN", value: (s) => (s.index_first ? 1 : 0) },
  { name: "answer_chars", dataType: "NUMERIC", value: (s) => s.answer_chars },
];

export async function emitInquiryScores(outcome: InquiryOutcome): Promise<void> {
  if (!isTelemetryEnabled()) return;
  const client = getLangfuseClient();
  if (!client) return;

  try {
    const scores = computeInquiryScores(outcome);
    for (const spec of INQUIRY_SCORE_SPECS) {
      client.score.activeTrace({
        name: spec.name,
        value: spec.value(scores),
        dataType: spec.dataType,
      });
    }
  } catch {
    // Chat reply already sent.
  }
}

export async function emitFilingOutcomeScore(input: {
  filedPath?: string;
  skipReason?: string;
}): Promise<void> {
  if (!isTelemetryEnabled()) return;
  const client = getLangfuseClient();
  if (!client) return;

  const value = input.filedPath ? "filed" : `not_filed:${input.skipReason ?? "unknown"}`;

  try {
    client.score.activeTrace({
      name: "filing_outcome",
      value,
      dataType: "CATEGORICAL",
    });
  } catch {
    // Bookkeeping only.
  }
}
