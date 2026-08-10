import { afterEach, describe, expect, it, vi } from "vitest";

import type { InquiryOutcome } from "./agent";
import {
  buildRetrievedPagesSummary,
  computeInquiryScores,
  countUnknownCitations,
  emitInquiryScores,
  extractRetrievedPaths,
} from "./scores";
import * as telemetry from "./telemetry";
import { resetLangfuseClientForTests } from "./telemetry";
import { WIKI_INDEX_PATH } from "./tools/wiki";

afterEach(() => {
  process.env.LANGFUSE_PUBLIC_KEY = "";
  process.env.LANGFUSE_SECRET_KEY = "";
  resetLangfuseClientForTests();
});

function answerSteps(
  toolResults: { toolName: string; output: unknown; input?: unknown }[],
): Extract<InquiryOutcome, { kind: "answer" }>["steps"] {
  return [
    {
      toolResults: toolResults.map((tr, i) => ({
        type: "tool-result" as const,
        toolCallId: `c${i}`,
        toolName: tr.toolName,
        input: tr.input ?? {},
        output: tr.output,
      })),
    },
  ] as never;
}

describe("computeInquiryScores", () => {
  it("scores non-answer outcomes with zero exploration metrics", () => {
    const scores = computeInquiryScores({
      kind: "needs_link",
      text: "please link",
      authorizationUrl: "https://example",
    });
    expect(scores).toEqual({
      outcome_kind: "needs_link",
      cited_path_count: 0,
      answer_cites_paths: true,
      unknown_citation_count: 0,
      step_count: 0,
      tool_error_count: 0,
      index_first: false,
      answer_chars: "please link".length,
    });
  });

  it("sets index_first when the first wiki_cat is the catalog and no index_required errors", () => {
    const outcome: InquiryOutcome = {
      kind: "answer",
      text: "See https://wiki.gdgs.jp/wiki/umeda-hall",
      steps: answerSteps([
        {
          toolName: "wiki_cat",
          input: { path: WIKI_INDEX_PATH },
          output: { path: WIKI_INDEX_PATH, content: "catalog" },
        },
        {
          toolName: "wiki_cat",
          input: { path: "/wiki/venues/umeda-hall" },
          output: { path: "/wiki/venues/umeda-hall", content: "hall" },
        },
      ]),
    };
    const scores = computeInquiryScores(outcome);
    expect(scores.index_first).toBe(true);
    expect(scores.cited_path_count).toBe(1);
    expect(scores.answer_cites_paths).toBe(true);
    expect(scores.unknown_citation_count).toBe(0);
    expect(scores.step_count).toBe(1);
    expect(scores.tool_error_count).toBe(0);
  });

  it("clears index_first when wiki_cat hits index_required", () => {
    const scores = computeInquiryScores({
      kind: "answer",
      text: "nope",
      steps: answerSteps([
        {
          toolName: "wiki_search",
          input: { q: "x" },
          output: { error: "index_required", message: "read index first" },
        },
        {
          toolName: "wiki_cat",
          input: { path: WIKI_INDEX_PATH },
          output: { path: WIKI_INDEX_PATH, content: "catalog" },
        },
      ]),
    });
    expect(scores.index_first).toBe(false);
    expect(scores.tool_error_count).toBe(1);
  });

  it("counts fabricated /wiki/<slug> citations as unknown", () => {
    const outcome: InquiryOutcome = {
      kind: "answer",
      text: "See https://wiki.gdgs.jp/wiki/umeda-hall and https://wiki.gdgs.jp/wiki/invented-page",
      steps: answerSteps([
        {
          toolName: "wiki_cat",
          input: { path: WIKI_INDEX_PATH },
          output: { path: WIKI_INDEX_PATH, content: "catalog" },
        },
        {
          toolName: "wiki_cat",
          input: { path: "/wiki/venues/umeda-hall" },
          output: { path: "/wiki/venues/umeda-hall", content: "hall" },
        },
      ]),
    };
    expect(computeInquiryScores(outcome).unknown_citation_count).toBe(1);
  });

  it("marks answer_cites_paths false when cited paths are missing from the answer", () => {
    const scores = computeInquiryScores({
      kind: "answer",
      text: "No links here.",
      steps: answerSteps([
        {
          toolName: "wiki_cat",
          input: { path: WIKI_INDEX_PATH },
          output: { path: WIKI_INDEX_PATH, content: "catalog" },
        },
        {
          toolName: "wiki_cat",
          input: { path: "/wiki/venues/umeda-hall" },
          output: { path: "/wiki/venues/umeda-hall", content: "hall" },
        },
      ]),
    });
    expect(scores.answer_cites_paths).toBe(false);
    expect(scores.cited_path_count).toBe(1);
  });
});

describe("extractRetrievedPaths / countUnknownCitations / buildRetrievedPagesSummary", () => {
  it("includes index in retrieved paths but not in filing cited paths", () => {
    const steps = answerSteps([
      {
        toolName: "wiki_cat",
        output: { path: WIKI_INDEX_PATH, content: "catalog body" },
      },
      {
        toolName: "wiki_cat",
        output: { path: "/wiki/venues/a", content: "venue a" },
      },
    ]);
    expect(extractRetrievedPaths(steps)).toEqual([WIKI_INDEX_PATH, "/wiki/venues/a"]);
    expect(
      countUnknownCitations("https://wiki.gdgs.jp/wiki/index", extractRetrievedPaths(steps)),
    ).toBe(0);
  });

  it("truncates retrieved page bodies to the judge budget", () => {
    const steps = answerSteps([
      {
        toolName: "wiki_cat",
        output: { path: "/wiki/venues/a", content: "x".repeat(20_000) },
      },
    ]);
    expect(buildRetrievedPagesSummary(steps, 100).length).toBeLessThanOrEqual(100);
  });
});

describe("emitInquiryScores", () => {
  it("is a no-op without keys", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    await emitInquiryScores({ kind: "temporarily_unavailable", text: "wait" });
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("emits eight inquiry scores via activeTrace", async () => {
    process.env.LANGFUSE_PUBLIC_KEY = "pk";
    process.env.LANGFUSE_SECRET_KEY = "sk";
    const activeTrace = vi.fn();
    vi.spyOn(telemetry, "getLangfuseClient").mockReturnValue({
      score: { activeTrace },
    } as never);

    await emitInquiryScores({
      kind: "answer",
      text: "See https://wiki.gdgs.jp/wiki/umeda-hall",
      steps: answerSteps([
        {
          toolName: "wiki_cat",
          input: { path: WIKI_INDEX_PATH },
          output: { path: WIKI_INDEX_PATH, content: "catalog" },
        },
        {
          toolName: "wiki_cat",
          input: { path: "/wiki/venues/umeda-hall" },
          output: { path: "/wiki/venues/umeda-hall", content: "hall" },
        },
      ]),
    });

    expect(activeTrace).toHaveBeenCalledTimes(8);
    expect(activeTrace.mock.calls.map(([entry]) => entry.name)).toEqual([
      "outcome_kind",
      "cited_path_count",
      "answer_cites_paths",
      "unknown_citation_count",
      "step_count",
      "tool_error_count",
      "index_first",
      "answer_chars",
    ]);
    expect(activeTrace.mock.calls.map(([entry]) => entry.dataType)).toEqual([
      "CATEGORICAL",
      "NUMERIC",
      "BOOLEAN",
      "NUMERIC",
      "NUMERIC",
      "NUMERIC",
      "BOOLEAN",
      "NUMERIC",
    ]);
  });
});
