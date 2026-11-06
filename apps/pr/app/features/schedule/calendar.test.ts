import { describe, expect, it } from "vitest";
import { buildCalendar, fromJstLocal, jstDate, jstTime, toJstLocal, weekOf } from "./calendar";
import type { ScheduleItem } from "./item";

const item = (id: number, dueAt: number, parent: number | null = null) =>
  ({ id, dueAt, derivedFromItemId: parent }) as ScheduleItem;

describe("calendar", () => {
  it("converts datetime-local in JST", () => {
    const at = fromJstLocal("2026-10-06T18:00");
    expect(at).toBe(Date.UTC(2026, 9, 6, 9) / 1000);
    expect(toJstLocal(at as number)).toBe("2026-10-06T18:00");
    expect(jstTime(at as number)).toBe("18:00");
    expect(fromJstLocal("2026-10-06")).toBeNull();
  });
  it("puts a JST late-night item on the JST date", () => {
    expect(jstDate(Date.UTC(2026, 9, 5, 16) / 1000)).toBe("2026-10-06");
  });
  it("starts weeks on Monday", () => {
    expect(weekOf(Date.UTC(2026, 9, 18, 3) / 1000)).toBe("2026-10-12");
  });
  it("keeps derived items under their parent", () => {
    const parent = Date.UTC(2026, 9, 6, 9) / 1000;
    const weeks = buildCalendar([item(2, parent - 3600 * 24, 1), item(1, parent)]);
    expect(weeks).toHaveLength(1);
    expect(weeks[0]?.days).toHaveLength(1);
    expect(weeks[0]?.days[0]?.rows[0]?.children.map((c) => c.id)).toEqual([2]);
  });
});
