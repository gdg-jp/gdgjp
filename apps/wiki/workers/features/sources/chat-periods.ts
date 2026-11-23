export const CHAT_DOCUMENT_MAX_LINES = 500;

export function periodTitle(firstWeek: string, lastWeek = firstWeek): string {
  const end = new Date(`${lastWeek}T00:00:00Z`);
  end.setUTCDate(end.getUTCDate() + 6);
  return `${firstWeek} – ${end.toISOString().slice(0, 10)}`;
}

export function markdownLineCount(markdown: string): number {
  const trimmed = markdown.trimEnd();
  return trimmed ? trimmed.split("\n").length : 0;
}

export function documentFirstWeek(path: string): string | null {
  return /(?:^|\/)(\d{4}-\d{2}-\d{2})\.md$/.exec(path)?.[1] ?? null;
}

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
