import { nowSeconds } from "../../lib";
import { MAX_BUNDLE_PAGES, buildBundle } from "./bundle";
import type { DegradedHit, Delivery, PendingAnswer, PendingStore } from "./pending";
import type { Venue } from "./reader";
import type { PageRead, Reader, WikiClient } from "./wiki";

export const RUNNER_STALE_SECONDS = 60;

export type AnswerResult = {
  answer: string;
  citations: Array<{ url: string; quote?: string }>;
  confidence: "high" | "medium" | "low";
  unanswered: boolean;
  durationMs?: number;
};

export type Reply = {
  text: string;
  citations: string[];
  degraded: boolean;
  publicReply: boolean;
  jobId: string;
  english?: boolean;
  suppressEmbeds?: boolean;
};

export type InquiryDeps = {
  wiki: WikiClient;
  pending: PendingStore;
  deliver(delivery: Delivery, reply: Reply): Promise<void>;
  progress?(delivery: Delivery, text: string): Promise<void>;
  schedule(): Promise<void>;
  now?: () => number;
};

export type InquiryInput = {
  question: string;
  reader: Reader;
  venue: Venue;
  spaces: string[];
  delivery: Delivery;
  publicReply: boolean;
  platform: "discord" | "google-chat";
  chatUserId: string;
};

export async function startInquiry(input: InquiryInput, deps: InquiryDeps): Promise<PendingAnswer> {
  const now = (deps.now ?? nowSeconds)();
  const scope = await searchScope(input, deps);
  const search = await deps.wiki.search(input.reader, input.question, scope);
  const wanted = uniquePages(search.pages).slice(0, MAX_BUNDLE_PAGES);
  const pages = (
    await Promise.all(wanted.map((hit) => deps.wiki.page(input.reader, hit.space, hit.slug)))
  ).filter((page): page is PageRead => page !== null);
  const indexes = (
    await Promise.all(
      search.spaces.slice(0, 3).map((space) => deps.wiki.page(input.reader, space, "index")),
    )
  ).filter((page): page is PageRead => page !== null);
  const hits: DegradedHit[] = [
    ...search.pages.map((page) => ({
      title: page.title,
      url: page.url,
      snippet: page.snippets[0] ?? "",
    })),
    ...search.raw
      .filter((hit) => hit.url)
      .map((hit) => ({ title: hit.title, url: hit.url as string, snippet: hit.snippet })),
  ].slice(0, 5);
  const excludedSpaces = search.truncatedSpaces
    ? input.spaces.filter((space) => !search.spaces.includes(space))
    : [];
  const base = {
    delivery: input.delivery,
    question: input.question,
    hits,
    spaces: search.spaces,
    excludedSpaces,
    excludedPages: search.excludedPages ?? 0,
    publicReply: input.publicReply,
    platform: input.platform,
    chatUserId: input.chatUserId,
    venue: input.venue.kind,
    readerKind: input.reader.kind,
    createdAt: now,
  };

  if (pages.length === 0 && search.raw.length === 0) {
    const row: PendingAnswer = {
      ...base,
      jobId: `empty-${crypto.randomUUID()}`,
      deadlineAt: now,
      status: "answered",
    };
    await deps.pending.insert(row);
    await deps.deliver(input.delivery, nothingReadableReply(row));
    return row;
  }

  const lastSeen = await deps.wiki.runnerLastSeen().catch(() => null);
  if (lastSeen === null || now - lastSeen > RUNNER_STALE_SECONDS) {
    const row: PendingAnswer = {
      ...base,
      jobId: `degraded-${crypto.randomUUID()}`,
      deadlineAt: now,
      status: "degraded",
    };
    await deps.deliver(input.delivery, degradedReply(row));
    return row;
  }
  if (deps.progress) {
    await deps
      .progress(input.delivery, progressText(input.question, pages.length, search.raw.length))
      .catch(() => undefined);
  }
  const bundle = buildBundle({ question: input.question, search, pages, indexes });
  const job = await deps.wiki.enqueueAnswer(input.reader, {
    question: input.question,
    spaces: search.spaces,
    bundle,
  });
  const row: PendingAnswer = {
    ...base,
    jobId: job.jobId,
    deadlineAt: job.deadlineAt,
    status: "pending",
  };
  await deps.pending.insert(row);
  await deps.schedule();
  return row;
}

export function progressText(question: string, pageCount: number, rawCount: number): string {
  const en = isEnglish(question);
  const found = en
    ? `Reading ${pageCount} page(s)${rawCount > 0 ? ` and ${rawCount} source excerpt(s)` : ""}`
    : `${pageCount} ページ${rawCount > 0 ? `と ${rawCount} 件の原資料` : ""}を読んで`;
  const wait = en ? "writing the answer (about a minute)…" : "回答を作成中（1 分ほど）…";
  return `${questionLine(question)}\n\n⏳ ${found}${en ? ", " : ""}${wait}`;
}

export function isEnglish(question: string): boolean {
  return !/[\u3040-\u30ff\u3400-\u9fff]/.test(question);
}

async function searchScope(input: InquiryInput, deps: InquiryDeps): Promise<string[]> {
  if (input.spaces.length > 0) return input.spaces;
  const reachable = await deps.wiki.spaces(input.reader).catch(() => []);
  const real = reachable.map((space) => space.slug).filter((slug) => !slug.startsWith("e2e-"));
  return real.length === reachable.length ? [] : real;
}

function uniquePages<T extends { space: string; slug: string }>(pages: readonly T[]): T[] {
  const seen = new Set<string>();
  return pages.filter((page) => {
    const key = `${page.space}/${page.slug}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export async function answerReady(
  jobId: string,
  outcome: { status: string; result?: AnswerResult },
  deps: InquiryDeps,
): Promise<{ delivered: boolean; row: PendingAnswer | null }> {
  const row = await deps.pending.get(jobId);
  if (!row || row.status !== "pending") return { delivered: false, row };
  if (outcome.status !== "succeeded" || !outcome.result) {
    if (!(await deps.pending.settle(jobId, "degraded"))) return { delivered: false, row };
    await deps.deliver(row.delivery, degradedReply(row));
    return { delivered: true, row: { ...row, status: "degraded" } };
  }
  if (!(await deps.pending.settle(jobId, "answered"))) return { delivered: false, row };
  await deps.deliver(row.delivery, answerReply(row, outcome.result));
  return { delivered: true, row: { ...row, status: "answered" } };
}

export async function sweepOverdue(deps: InquiryDeps): Promise<number> {
  const now = (deps.now ?? nowSeconds)();
  let count = 0;
  for (const row of await deps.pending.overdue(now)) {
    if (!(await deps.pending.settle(row.jobId, "degraded"))) continue;
    await deps.wiki.expireJob(row.jobId).catch(() => undefined);
    await deps.deliver(row.delivery, degradedReply(row));
    count += 1;
  }
  return count;
}

const MAX_TEXT = 1800;
const MAX_QUESTION = 200;

function questionLine(question: string): string {
  const oneLine = question.replace(/\s+/g, " ").trim();
  const shown = oneLine.length > MAX_QUESTION ? `${oneLine.slice(0, MAX_QUESTION)}…` : oneLine;
  return `> **Q:** ${shown}`;
}

export function describeSpaces(
  spaces: readonly string[],
  readable: ReadonlySet<string> = new Set(spaces),
  en = false,
): string {
  const shared = spaces.filter((space) => !space.startsWith("u-"));
  const personal = spaces.length - shared.length;
  const listed = shared.filter((space) => readable.has(space));
  const unreadable = shared.length - listed.length;
  if (listed.length === 0 && unreadable > 0) {
    const total = unreadable + personal;
    return en
      ? `${total} space(s), nothing readable here`
      : `${total} スペース、この権限で読めるページなし`;
  }
  const parts = listed.slice(0, 4);
  const more = listed.length - parts.length + personal;
  if (more > 0) parts.push(en ? `and ${more} more` : `ほか ${more} 件`);
  if (unreadable > 0)
    parts.push(
      en
        ? `${unreadable} space(s) with nothing readable here`
        : `この権限で読めるページのないスペース ${unreadable} 件`,
    );
  return parts.join(", ") || (en ? "none" : "なし");
}

function hiddenPagesLine(row: PendingAnswer, en: boolean): string | null {
  const n = row.excludedPages ?? 0;
  if (n === 0) return null;
  return en
    ? `${n} of the pages the search matched are not readable here.`
    : `検索でヒットしたページのうち ${n} 件は、この場所の権限では読めません。`;
}

function readableSpaces(row: PendingAnswer): Set<string> {
  const found = new Set<string>();
  for (const hit of row.hits) {
    const match = /\/s\/([^/]+)\//.exec(hit.url);
    if (match) found.add(decodeURIComponent(match[1]));
  }
  return found;
}

const REANSWER_HINT_JA =
  "「自分の権限で再回答」を押すと、あなたが閲覧できるページも含めて探します。";
export const REANSWER_LABEL_JA = "自分の権限で再回答";
export const REANSWER_LABEL_EN = "Answer with my permissions";
const REANSWER_HINT_EN = `Press "${REANSWER_LABEL_EN}" to search again with the pages you can read.`;

export function nothingReadableReply(row: PendingAnswer): Reply {
  const en = isEnglish(row.question);
  const spaces = describeSpaces(row.spaces, new Set(), en);
  const lines = [
    questionLine(row.question),
    "",
    en
      ? `No wiki page is readable here for this question (searched: ${spaces}).`
      : `この場所の権限で読めるページが見つかりませんでした（検索したスペース: ${spaces}）。`,
  ];
  const hidden = hiddenPagesLine(row, en);
  if (hidden) lines.push(hidden);
  if (row.publicReply) lines.push(en ? REANSWER_HINT_EN : REANSWER_HINT_JA);
  else if (row.readerKind !== "user")
    lines.push(en ? "Link your account with /login first." : "先に /login で連携してください。");
  return {
    text: lines.join("\n"),
    citations: [],
    degraded: false,
    publicReply: row.publicReply,
    jobId: row.jobId,
    english: en,
  };
}

export function flattenTables(text: string): string {
  const lines = text.split("\n");
  const out: string[] = [];
  let header: string[] | null = null;
  for (const line of lines) {
    const trimmed = line.trim();
    if (!/^\|.*\|$/.test(trimmed)) {
      header = null;
      out.push(line);
      continue;
    }
    const cells = trimmed
      .slice(1, -1)
      .split("|")
      .map((cell) => cell.trim());
    if (cells.every((cell) => /^:?-{2,}:?$/.test(cell))) continue;
    if (header === null) {
      header = cells;
      continue;
    }
    out.push(
      `- ${cells
        .map((cell, i) => (header?.[i] && i > 0 ? `${header[i]}: ${cell}` : cell))
        .filter(Boolean)
        .join(" / ")}`,
    );
  }
  return out.join("\n");
}

export function answerReply(row: PendingAnswer, result: AnswerResult): Reply {
  const answer = flattenTables(result.answer.trim()).slice(0, MAX_TEXT);
  const citations = [...new Set(result.citations.map((citation) => citation.url))].slice(0, 5);
  const listed = citations.filter((url) => !answer.includes(url));
  const en = isEnglish(row.question);
  const lines = [questionLine(row.question), "", answer];
  if (result.unanswered) {
    const spaces = describeSpaces(row.spaces, readableSpaces(row), en);
    const partial = citations.length > 0 && result.confidence !== "low";
    lines.push(
      "",
      en
        ? `${partial ? "Part of this is " : "This is "}not in the pages ${row.readerKind === "user" ? "you can read" : "readable here"} (searched: ${spaces}).`
        : `${partial ? "一部は" : ""}${row.readerKind === "user" ? "あなたが読めるページ" : "この場所で読めるページ"}には見つかりませんでした（検索したスペース: ${spaces}）。`,
    );
    const hidden = hiddenPagesLine(row, en);
    if (hidden) lines.push(hidden);
    if (row.publicReply) lines.push(en ? REANSWER_HINT_EN : REANSWER_HINT_JA);
  }
  if (listed.length > 0) lines.push("", ...listed.map((url) => `- <${url}>`));
  if (row.excludedSpaces.length > 0)
    lines.push(
      "",
      en
        ? `Spaces left out: ${describeSpaces(row.excludedSpaces)}`
        : `対象外にしたスペース: ${describeSpaces(row.excludedSpaces)}`,
    );
  return {
    text: lines.join("\n"),
    citations,
    degraded: false,
    publicReply: row.publicReply,
    jobId: row.jobId,
    english: en,
    suppressEmbeds: result.unanswered,
  };
}

export function degradedReply(row: PendingAnswer): Reply {
  const lines = [
    questionLine(row.question),
    "",
    "エージェントが応答していないため、検索結果のみを表示します。",
  ];
  if (row.hits.length === 0) lines.push("", "該当するページは見つかりませんでした。");
  for (const hit of row.hits) {
    const snippet = hit.snippet.replace(/\s+/g, " ").trim().slice(0, 160);
    lines.push("", `**${hit.title}** <${hit.url}>`, snippet ? `> ${snippet}` : "");
  }
  return {
    text: lines.join("\n").slice(0, MAX_TEXT + 150),
    citations: row.hits.map((hit) => hit.url),
    degraded: true,
    publicReply: row.publicReply,
    jobId: row.jobId,
  };
}
