/**
 * Knowledge-platform eval (Stage 06). Never runs against production spaces: every case must
 * target an `e2e-` space, and the wiki confines eval readers to those spaces as well.
 *
 *   AGENT_SERVICE_TOKEN=… pnpm --filter @gdgjp/agent eval -- --set ../../docs/eval/qa
 *
 * Exit 1 if any leak (a forbidden term in a search hit, an answer or a citation).
 */
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildBundle } from "../src/features/inquiry/bundle";
import type { PageRead, SearchResult } from "../src/features/inquiry/wiki";
import { type EvalCase, loadCases } from "./cases";
import { evalHeader } from "./identities";
import {
  type AnswerOutput,
  type CaseResult,
  diffReport,
  scoreAnswer,
  scoreSearch,
  summarize,
} from "./report";

type Options = { set: string; wiki: string; answers: boolean; timeoutMs: number; out: string };

function parseArgs(argv: string[]): Options {
  const options: Options = {
    set: "../../docs/eval/qa",
    wiki: process.env.EVAL_WIKI_URL ?? "https://wiki.gdgs.jp",
    answers: true,
    timeoutMs: 180_000,
    out: "eval/results",
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--set") options.set = argv[++i] ?? options.set;
    else if (arg === "--wiki") options.wiki = argv[++i] ?? options.wiki;
    else if (arg === "--search-only") options.answers = false;
    else if (arg === "--timeout") options.timeoutMs = Number(argv[++i]) * 1000;
    else if (arg === "--out") options.out = argv[++i] ?? options.out;
  }
  return options;
}

function client(wiki: string, token: string, asker: EvalCase["asker"]) {
  const headers = {
    authorization: `Bearer ${token}`,
    "x-agent-eval-as": evalHeader(asker),
    accept: "application/json",
  };
  async function call<T>(
    path: string,
    init: RequestInit = {},
  ): Promise<{ status: number; body: T }> {
    const response = await fetch(`${wiki}${path}`, {
      ...init,
      headers: {
        ...headers,
        ...(init.body
          ? { "content-type": "application/json", "x-agent-service-token": token }
          : {}),
      },
    });
    return { status: response.status, body: (await response.json().catch(() => ({}))) as T };
  }
  return {
    search: (q: string, space: string) =>
      call<SearchResult>(
        `/api/agent/knowledge-search?${new URLSearchParams({ q, space, layers: "page,acl,raw", limit: "12" })}`,
      ),
    page: (space: string, slug: string) =>
      call<PageRead>(`/api/agent/page?${new URLSearchParams({ space, slug })}`),
    enqueue: (question: string, space: string, bundle: Record<string, string>) =>
      call<{ jobId: string }>("/api/agent/jobs/answer", {
        method: "POST",
        body: JSON.stringify({ question, spaces: [space], bundle }),
      }),
    job: (id: string) =>
      call<{ status: string; result: AnswerOutput | null; error: string | null }>(
        `/api/agent/jobs/${id}`,
      ),
  };
}

async function runCase(c: EvalCase, options: Options, token: string): Promise<CaseResult> {
  const api = client(options.wiki, token, c.asker);
  const search = await api.search(c.question, c.space);
  const hits =
    search.status === 200
      ? search.body
      : { spaces: [], truncatedSpaces: false, pages: [], raw: [] };
  const { hit5, searchLeaks } = scoreSearch(c, hits.pages);
  const rawLeaks = scoreSearch(
    c,
    hits.raw.map((r) => ({ slug: "", title: r.title, url: r.url ?? "", snippets: [r.snippet] })),
  ).searchLeaks;
  const result: CaseResult = {
    id: c.id,
    question: c.question,
    asker: c.asker,
    space: c.space,
    hit5,
    searchLeaks: [...new Set([...searchLeaks, ...rawLeaks])],
    answer: null,
    answerError: null,
    answerLeaks: [],
    containsOk: null,
    refusalOk: null,
    unanswered: null,
    latencyMs: null,
    evidence: {},
  };
  if (!options.answers) return result;
  const pages = (
    await Promise.all(hits.pages.slice(0, 8).map((hit) => api.page(hit.space, hit.slug)))
  )
    .filter((r) => r.status === 200)
    .map((r) => r.body);
  for (const page of pages) result.evidence[page.url] = page.content;
  const started = Date.now();
  const job = await api.enqueue(
    c.question,
    c.space,
    buildBundle({ question: c.question, search: hits, pages, indexes: [] }),
  );
  if (job.status !== 200) {
    result.answerError = `enqueue ${job.status}`;
    return result;
  }
  while (Date.now() - started < options.timeoutMs) {
    await new Promise((resolve) => setTimeout(resolve, 3000));
    const state = await api.job(job.body.jobId);
    if (state.body.status === "queued" || state.body.status === "leased") continue;
    result.latencyMs = Date.now() - started;
    if (state.body.status !== "succeeded" || !state.body.result) {
      result.answerError = `${state.body.status}: ${state.body.error ?? ""}`.slice(0, 300);
      return result;
    }
    result.answer = state.body.result;
    result.unanswered = state.body.result.unanswered;
    Object.assign(result, scoreAnswer(c, state.body.result));
    return result;
  }
  result.answerError = "timeout (is a runner with RUNNER_TYPES=answer running?)";
  return result;
}

function previousResults(
  dir: string,
): { metrics: ReturnType<typeof summarize>; results: CaseResult[] } | undefined {
  const files = readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .sort();
  const last = files.at(-1);
  return last ? JSON.parse(readFileSync(join(dir, last), "utf8")) : undefined;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const token = process.env.AGENT_SERVICE_TOKEN;
  if (!token) throw new Error("AGENT_SERVICE_TOKEN is required");
  const cases = loadCases(options.set); // throws before any request if a case leaves e2e spaces
  const results: CaseResult[] = [];
  for (const c of cases) {
    process.stderr.write(`${c.id} (${c.asker}) … `);
    const r = await runCase(c, options, token);
    process.stderr.write(
      `${r.hit5 === false ? "miss " : ""}${r.answerError ?? ""}${r.searchLeaks.length + r.answerLeaks.length ? " LEAK" : ""}\n`,
    );
    results.push(r);
  }
  const metrics = summarize(results, cases);
  mkdirSync(options.out, { recursive: true });
  const previous = previousResults(options.out);
  const file = join(options.out, `${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  writeFileSync(
    file,
    `${JSON.stringify({ at: new Date().toISOString(), wiki: options.wiki, metrics, results }, null, 2)}\n`,
  );
  console.log(diffReport({ metrics, results }, previous));
  console.log(`results: ${file}`);
  if (metrics.leaks > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 2;
});
