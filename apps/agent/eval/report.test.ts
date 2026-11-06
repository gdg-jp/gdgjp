import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadCases, validateCase } from "./cases";
import { evalHeader } from "./identities";
import { diffReport, scoreAnswer, scoreSearch, summarize } from "./report";

const base = {
  id: "q1",
  space: "e2e-eval",
  asker: "member",
  question: "会場は？",
  expected_pages: ["venue"],
  expected_answer_contains: ["梅田"],
  forbidden_answer_contains: ["12万円"],
  expected_refusal: false,
  tags: [],
};

describe("eval cases", () => {
  it("refuses to run a case outside the e2e spaces", () => {
    expect(() => validateCase({ ...base, space: "gdg-jp" }, "x.yaml")).toThrow(/e2e-/);
    const dir = mkdtempSync(join(tmpdir(), "eval-"));
    writeFileSync(
      join(dir, "a.yaml"),
      "- id: a\n  space: gdg-jp\n  asker: member\n  question: q\n",
    );
    expect(() => loadCases(dir)).toThrow(/e2e-/);
  });

  it("maps askers to eval identities", () => {
    expect(evalHeader("guest")).toBe("guest");
    expect(evalHeader("organizer")).toBe("organizer:e2e-chapter");
  });
});

describe("scoring", () => {
  const c = validateCase(base, "x.yaml");

  it("finds hits in the top 5 and leaks in snippets", () => {
    const hits = [{ slug: "venue", title: "会場", url: "u", snippets: ["契約 12万円"] }];
    expect(scoreSearch(c, hits)).toEqual({ hit5: true, searchLeaks: ["12万円"] });
  });

  it("flags a leak in a citation quote, not only in the answer", () => {
    const scored = scoreAnswer(c, {
      answer: "梅田です",
      citations: [{ url: "https://w/s/e2e-eval/wiki/venue", quote: "契約は12万円" }],
      confidence: "high",
      unanswered: false,
    });
    expect(scored).toMatchObject({ answerLeaks: ["12万円"], containsOk: true, refusalOk: null });
  });

  it("fails a refusal case that cites a page outside its expected pages", () => {
    const refusal = validateCase({ ...base, expected_refusal: true, expected_pages: [] }, "x.yaml");
    const ok = scoreAnswer(refusal, {
      answer: "わかりません",
      citations: [],
      confidence: "low",
      unanswered: true,
    });
    const stray = scoreAnswer(refusal, {
      answer: "わかりません",
      citations: [{ url: "https://w/s/e2e-eval/wiki/secret" }],
      confidence: "low",
      unanswered: true,
    });
    expect(ok.refusalOk).toBe(true);
    expect(stray.refusalOk).toBe(false);
  });

  it("summarizes, counts leaks and reports them in the diff", () => {
    const result = {
      id: "q1",
      asker: "member",
      space: "e2e-eval",
      hit5: true,
      searchLeaks: [],
      answer: null,
      answerError: null,
      answerLeaks: ["12万円"],
      containsOk: true,
      refusalOk: null,
      unanswered: false,
      latencyMs: 40_000,
      evidence: {},
    };
    const metrics = summarize([result], [c]);
    expect(metrics).toMatchObject({ hitAt5: 1, leaks: 1, unansweredRate: 0, latencyP95Ms: 40_000 });
    expect(diffReport({ metrics, results: [result] })).toContain('LEAK q1 (member): "12万円"');
  });
});
