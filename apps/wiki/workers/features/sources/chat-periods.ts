/**
 * Periods of a Discord channel / Google Chat space document (pure helpers, no network).
 *
 * A week (Monday to Sunday, source time zone) is the smallest period. Consecutive weeks
 * with messages share one document until the next week would take it past
 * `CHAT_DOCUMENT_MAX_LINES`, so a quiet channel is a few documents instead of one tiny
 * file per week, and a busy week is still a document of its own. A document's path is
 * its first week's Monday (`YYYY-MM-DD.md`); its title spans first Monday to last Sunday.
 */

export const CHAT_DOCUMENT_MAX_LINES = 500;

/** `first – last Sunday`: the title of a document covering firstWeek … lastWeek. */
export function periodTitle(firstWeek: string, lastWeek = firstWeek): string {
  const end = new Date(`${lastWeek}T00:00:00Z`);
  end.setUTCDate(end.getUTCDate() + 6);
  return `${firstWeek} – ${end.toISOString().slice(0, 10)}`;
}

export function markdownLineCount(markdown: string): number {
  const trimmed = markdown.trimEnd();
  return trimmed ? trimmed.split("\n").length : 0;
}

/** First week (Monday date) of a stored document path such as `channels/1/2026-11-02.md`. */
export function documentFirstWeek(path: string): string | null {
  return /(?:^|\/)(\d{4}-\d{2}-\d{2})\.md$/.exec(path)?.[1] ?? null;
}

/**
 * Take the next document starting at `weeks[start]`: that week, plus each following week
 * while the rendered document stays within `maxLines`. A week that alone exceeds it is a
 * document of its own. Returns the messages and the index of the first week left over.
 */
export function packNextDocument<T>(
  weeks: readonly string[],
  start: number,
  load: (week: string) => T[],
  measure: (messages: T[]) => number,
  maxLines = CHAT_DOCUMENT_MAX_LINES,
): { messages: T[]; end: number } {
  const first = weeks[start];
  if (first === undefined) return { messages: [], end: start };
  let messages = load(first);
  let end = start + 1;
  while (end < weeks.length) {
    const week = weeks[end];
    if (week === undefined) break;
    const candidate = [...messages, ...load(week)];
    if (measure(candidate) > maxLines) break;
    messages = candidate;
    end += 1;
  }
  return { messages, end };
}
