import { describe, expect, it } from "vitest";
import { parseDay, parseEventForm, parseSlotIds, parseTime } from "./validate";

function makeForm(entries: Array<[string, string]>): FormData {
  const fd = new FormData();
  for (const [k, v] of entries) fd.append(k, v);
  return fd;
}

describe("parseTime", () => {
  it("accepts HH:MM", () => {
    expect(parseTime("00:00")).toBe("00:00");
    expect(parseTime("09:30")).toBe("09:30");
    expect(parseTime("23:59")).toBe("23:59");
  });
  it("rejects invalid", () => {
    expect(parseTime("24:00")).toBeNull();
    expect(parseTime("9:30")).toBeNull();
    expect(parseTime("9:3")).toBeNull();
    expect(parseTime(42)).toBeNull();
    expect(parseTime("")).toBeNull();
  });
});

describe("parseDay", () => {
  it("accepts 0..6", () => {
    expect(parseDay("0")).toBe(0);
    expect(parseDay("6")).toBe(6);
    expect(parseDay(3)).toBe(3);
  });
  it("rejects out of range or invalid", () => {
    expect(parseDay("-1")).toBeNull();
    expect(parseDay("7")).toBeNull();
    expect(parseDay("foo")).toBeNull();
    expect(parseDay(1.5)).toBeNull();
  });
});

describe("parseEventForm", () => {
  it("parses a valid form with dedup", () => {
    const fd = makeForm([
      ["title", "  Team sync "],
      ["description", "  weekly  "],
      ["slot_day", "0"],
      ["slot_time", "19:00"],
      ["slot_day", "0"],
      ["slot_time", "19:00"], // duplicate
      ["slot_day", "2"],
      ["slot_time", "20:00"],
    ]);
    const r = parseEventForm(fd);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("expected ok");
    expect(r.value.title).toBe("Team sync");
    expect(r.value.description).toBe("weekly");
    expect(r.value.slots).toEqual([
      { dayOfWeek: 0, startTime: "19:00" },
      { dayOfWeek: 2, startTime: "20:00" },
    ]);
  });

  it("rejects missing title", () => {
    const fd = makeForm([
      ["title", "   "],
      ["slot_day", "0"],
      ["slot_time", "19:00"],
    ]);
    const r = parseEventForm(fd);
    expect(r.ok).toBe(false);
  });

  it("rejects no valid slots", () => {
    const fd = makeForm([
      ["title", "T"],
      ["slot_day", "9"],
      ["slot_time", "25:99"],
    ]);
    const r = parseEventForm(fd);
    expect(r.ok).toBe(false);
  });
});

describe("parseSlotIds", () => {
  it("returns unique positive ints", () => {
    const fd = makeForm([
      ["slot_id", "1"],
      ["slot_id", "2"],
      ["slot_id", "2"],
      ["slot_id", "abc"],
      ["slot_id", "0"],
      ["slot_id", "-5"],
    ]);
    expect(parseSlotIds(fd).sort()).toEqual([1, 2]);
  });
});
