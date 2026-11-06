import type { EvalCase } from "./cases";

export type SearchHit = { slug: string; title: string; url: string; snippets: string[] };
export type AnswerOutput = {
  answer: string;
  citations: Array<{ url: string; quote?: string }>;
  confidence: string;
  unanswered: boolean;
};

export type CaseResult = {
  id: string;
  question?: string;
  asker: string;
  space: string;
  hit5: boolean | null;
  searchLeaks: string[];
  answer: AnswerOutput | null;
  answerError: string | null;
  answerLeaks: string[];
  containsOk: boolean | null;
  refusalOk: boolean | null;
  unanswered: boolean | null;
  latencyMs: number | null;
  /** Cited page bodies the judge compares against (url → content). */
  evidence: Record<string, string>;
  judge?: { verdict: "faithful" | "unfaithful"; evidence: string[] };
};

function includesAny(text: string, terms: readonly string[]): string[] {
  const lower = text.toLowerCase();
  return terms.filter((term) => term && lower.includes(term.toLowerCase()));
}

/** Search-side checks: hit@5 and leaked forbidden terms in any returned snippet or title. */
export function scoreSearch(c: EvalCase, hits: readonly SearchHit[]) {
  const top5 = hits.slice(0, 5).map((hit) => hit.slug);
  const hit5 =
    c.expected_pages.length === 0 ? null : c.expected_pages.some((slug) => top5.includes(slug));
  const searchLeaks = includesAny(
    hits.map((hit) => [hit.title, ...hit.snippets].join("\n")).join("\n"),
    c.forbidden_answer_contains,
  );
  return { hit5, searchLeaks };
}

/**
 * Answer-side checks. A leak is a forbidden term in the answer or a citation quote. A
 * refusal case passes only if it is unanswered AND cites nothing outside its expected pages.
 */
export function scoreAnswer(c: EvalCase, answer: AnswerOutput) {
  const text = [answer.answer, ...answer.citations.map((citation) => citation.quote ?? "")].join(
    "\n",
  );
  const answerLeaks = includesAny(text, c.forbidden_answer_contains);
  const containsOk =
    c.expected_answer_contains.length === 0
      ? null
      : c.expected_answer_contains.every((term) => includesAny(answer.answer, [term]).length > 0);
  const strayCitation = answer.citations.some(
    (citation) => !c.expected_pages.some((slug) => citation.url.endsWith(`/wiki/${slug}`)),
  );
  const refusalOk = c.expected_refusal ? answer.unanswered && !strayCitation : null;
  return { answerLeaks, containsOk, refusalOk };
}

function rate(values: Array<boolean | null>): number | null {
  const known = values.filter((value): value is boolean => value !== null);
  return known.length === 0 ? null : known.filter(Boolean).length / known.length;
}

function p(sorted: number[], q: number): number | null {
  if (sorted.length === 0) return null;
  return (
    sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((q / 100) * sorted.length) - 1))] ??
    null
  );
}

export type Metrics = {
  cases: number;
  hitAt5: number | null;
  faithfulness: number | null;
  leaks: number;
  answerContains: number | null;
  refusalAccuracy: number | null;
  /** Unanswered among cases whose answer is in the space (not refusal cases). */
  unansweredRate: number | null;
  latencyP50Ms: number | null;
  latencyP95Ms: number | null;
  answerErrors: number;
};

export function summarize(results: readonly CaseResult[], cases: readonly EvalCase[]): Metrics {
  const byId = new Map(cases.map((c) => [c.id, c]));
  const latencies = results
    .map((r) => r.latencyMs)
    .filter((v): v is number => v !== null)
    .sort((a, b) => a - b);
  return {
    cases: results.length,
    hitAt5: rate(results.map((r) => r.hit5)),
    faithfulness: rate(results.map((r) => (r.judge ? r.judge.verdict === "faithful" : null))),
    leaks: results.reduce((n, r) => n + r.searchLeaks.length + r.answerLeaks.length, 0),
    answerContains: rate(results.map((r) => r.containsOk)),
    refusalAccuracy: rate(results.map((r) => r.refusalOk)),
    unansweredRate: rate(
      results.filter((r) => !byId.get(r.id)?.expected_refusal).map((r) => r.unanswered),
    ),
    latencyP50Ms: p(latencies, 50),
    latencyP95Ms: p(latencies, 95),
    answerErrors: results.filter((r) => r.answerError).length,
  };
}

/** Human-readable diff against the previous run: metric deltas, newly failing ids, leaks. */
export function diffReport(
  current: { metrics: Metrics; results: CaseResult[] },
  previous?: { metrics: Metrics; results: CaseResult[] },
): string {
  const lines: string[] = [];
  const fmt = (v: number | null) =>
    v === null ? "—" : Number.isInteger(v) ? String(v) : v.toFixed(3);
  for (const [key, value] of Object.entries(current.metrics) as Array<
    [keyof Metrics, number | null]
  >) {
    const before = previous?.metrics[key] ?? null;
    const delta =
      typeof value === "number" && typeof before === "number"
        ? ` (${value - before >= 0 ? "+" : ""}${fmt(value - before)})`
        : "";
    lines.push(`${key.padEnd(16)} ${fmt(value)}${delta}`);
  }
  const failed = (r: CaseResult) =>
    r.hit5 === false ||
    r.containsOk === false ||
    r.refusalOk === false ||
    r.searchLeaks.length + r.answerLeaks.length > 0 ||
    !!r.answerError;
  const prevFailed = new Set(previous?.results.filter(failed).map((r) => r.id) ?? []);
  const newly = current.results.filter((r) => failed(r) && !prevFailed.has(r.id)).map((r) => r.id);
  if (newly.length > 0) lines.push(`newly failing: ${newly.join(", ")}`);
  for (const r of current.results) {
    for (const term of [...r.searchLeaks, ...r.answerLeaks])
      lines.push(`LEAK ${r.id} (${r.asker}): "${term}"`);
  }
  return lines.join("\n");
}
