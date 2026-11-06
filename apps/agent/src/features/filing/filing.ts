import type { AnswerResult } from "../inquiry/inquiry";
import type { WikiClient } from "../inquiry/wiki";

const MIN_ANSWER_CHARS = 200;
const MIN_CITED_PAGES = 2;

export type FilingProposal = { slug: string; title: string; summary: string; content: string };

/**
 * gdg-jp page URL → v1 workspace path (`/wiki/<tree path>`), which /api/agent/notes takes
 * as a citation. Answer notes are filed into gdg-jp only.
 */
export function workspacePath(url: string): string | null {
  const match = /\/s\/gdg-jp\/wiki\/([^?#]+)/.exec(url);
  return match?.[1] ? `/wiki/${decodeURIComponent(match[1])}` : null;
}

/**
 * File a reusable answer as an `answers/*` note, once per question (asked_questions). The
 * runner proposes it; the Worker only applies the v1 gate and calls the wiki AS the linked
 * asker, so the wiki's note ACL floor still decides. Public (guild) answers are never filed.
 */
export async function fileAnswer(
  input: {
    messageId: string;
    token: string | null;
    result: AnswerResult & { filing?: FilingProposal };
  },
  deps: { db: D1Database; wiki: WikiClient },
): Promise<"filed" | "skipped" | "duplicate"> {
  const { result, token } = input;
  const cited = [
    ...new Set(result.citations.map((c) => workspacePath(c.url)).filter((p): p is string => !!p)),
  ];
  if (
    !token ||
    !result.filing ||
    result.unanswered ||
    result.confidence !== "high" ||
    result.answer.trim().length < MIN_ANSWER_CHARS ||
    cited.length < MIN_CITED_PAGES
  ) {
    return "skipped";
  }
  const claim = await deps.db
    .prepare("INSERT OR IGNORE INTO asked_questions (message_id) VALUES (?)")
    .bind(input.messageId)
    .run();
  if ((claim.meta.changes ?? 0) === 0) return "duplicate";
  const note = await deps.wiki.postNote(token, {
    slug: result.filing.slug,
    title: result.filing.title,
    summary: result.filing.summary,
    content: result.filing.content.slice(0, 8000),
    citedPaths: cited.slice(0, 12),
  });
  return note.ok ? "filed" : "skipped";
}
