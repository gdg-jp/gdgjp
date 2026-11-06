import type { ScheduleItem } from "./item";

const JST_OFFSET = 9 * 3600;

/** "YYYY-MM-DD" in JST. */
export function jstDate(epochSeconds: number): string {
  return new Date((epochSeconds + JST_OFFSET) * 1000).toISOString().slice(0, 10);
}

/** "HH:mm" in JST. */
export function jstTime(epochSeconds: number): string {
  return new Date((epochSeconds + JST_OFFSET) * 1000).toISOString().slice(11, 16);
}

/** Epoch seconds from a "YYYY-MM-DDTHH:mm" value typed in JST (datetime-local). */
export function fromJstLocal(value: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const [, y, m, d, hh, mm] = match.map(Number) as number[];
  return Date.UTC(y as number, (m as number) - 1, d, hh, mm) / 1000 - JST_OFFSET;
}

export function toJstLocal(epochSeconds: number): string {
  return new Date((epochSeconds + JST_OFFSET) * 1000).toISOString().slice(0, 16);
}

/** Monday (JST) of the week containing the instant, as "YYYY-MM-DD". */
export function weekOf(epochSeconds: number): string {
  const date = new Date((epochSeconds + JST_OFFSET) * 1000);
  const day = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - day);
  return date.toISOString().slice(0, 10);
}

export type CalendarRow = { item: ScheduleItem; children: ScheduleItem[] };
export type CalendarWeek = { weekOf: string; days: { date: string; rows: CalendarRow[] }[] };

/**
 * Weeks → days → items, each derived item under its parent (even when it falls on another day,
 * so a reminder is never separated from the post it is for).
 */
export function buildCalendar(items: ScheduleItem[]): CalendarWeek[] {
  const children = new Map<number, ScheduleItem[]>();
  for (const item of items) {
    if (item.derivedFromItemId !== null) {
      children.set(item.derivedFromItemId, [...(children.get(item.derivedFromItemId) ?? []), item]);
    }
  }
  const ids = new Set(items.map((i) => i.id));
  const roots = items.filter((i) => i.derivedFromItemId === null || !ids.has(i.derivedFromItemId));
  const weeks = new Map<string, Map<string, CalendarRow[]>>();
  for (const item of [...roots].sort((a, b) => a.dueAt - b.dueAt || a.id - b.id)) {
    const week = weeks.get(weekOf(item.dueAt)) ?? new Map<string, CalendarRow[]>();
    weeks.set(weekOf(item.dueAt), week);
    const date = jstDate(item.dueAt);
    week.set(date, [
      ...(week.get(date) ?? []),
      { item, children: (children.get(item.id) ?? []).sort((a, b) => a.dueAt - b.dueAt) },
    ]);
  }
  return [...weeks.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([week, days]) => ({
      weekOf: week,
      days: [...days.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, rows]) => ({ date, rows })),
    }));
}
