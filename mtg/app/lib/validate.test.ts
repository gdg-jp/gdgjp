import { describe, expect, it } from "vitest";
import { parseEventForm, parseMinutes, parseSlotIds, parseTime } from "./validate";

function makeForm(entries: Array<[string, string]>): FormData {
  const fd = new FormData();
  for (const [k, v] of entries) fd.append(k, v);
  return fd;
}

describe("parseTime", () => {
  it("accepts HH:MM", () => {
    expect(parseTime("00:00")).toBe("00:00");
    expect(parseTime("23:59")).toBe("23:59");
  });
  it("rejects invalid", () => {
    expect(parseTime("24:00")).toBeNull();
    expect(parseTime("9:30")).toBeNull();
    expect(parseTime(42)).toBeNull();
  });
});

describe("parseMinutes", () => {
  it("accepts allowed lengths", () => {
    expect(parseMinutes("60")).toBe(60);
    expect(parseMinutes("30")).toBe(30);
  });
  it("rejects unknown", () => {
    expect(parseMinutes("13")).toBeNull();
    expect(parseMinutes("")).toBeNull();
  });
});

describe("parseEventForm", () => {
  it("expands a single day range into slots", () => {
    const fd = makeForm([
      ["title", "Team sync"],
      ["slot_minutes", "60"],
      ["day_0_start", "09:00"],
      ["day_0_end", "12:00"],
    ]);
    const r = parseEventForm(fd);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("expected ok");
    expect(r.value.slotMinutes).toBe(60);
    expect(r.value.slots).toEqual([
      { dayOfWeek: 0, startTime: "09:00" },
      { dayOfWeek: 0, startTime: "10:00" },
      { dayOfWeek: 0, startTime: "11:00" },
    ]);
  });

  it("handles multiple enabled days", () => {
    const fd = makeForm([
      ["title", "Sync"],
      ["slot_minutes", "30"],
      ["day_1_start", "19:00"],
      ["day_1_end", "20:00"],
      ["day_4_start", "10:00"],
      ["day_4_end", "11:00"],
    ]);
    const r = parseEventForm(fd);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("expected ok");
    expect(r.value.slots).toEqual([
      { dayOfWeek: 1, startTime: "19:00" },
      { dayOfWeek: 1, startTime: "19:30" },
      { dayOfWeek: 4, startTime: "10:00" },
      { dayOfWeek: 4, startTime: "10:30" },
    ]);
  });

  it("rejects when no day has a range", () => {
    const fd = makeForm([
      ["title", "X"],
      ["slot_minutes", "60"],
    ]);
    const r = parseEventForm(fd);
    expect(r.ok).toBe(false);
  });

  it("rejects when end is not after start", () => {
    const fd = makeForm([
      ["title", "X"],
      ["slot_minutes", "60"],
      ["day_0_start", "10:00"],
      ["day_0_end", "10:00"],
    ]);
    const r = parseEventForm(fd);
    expect(r.ok).toBe(false);
  });

  it("rejects when only one side of a range is set", () => {
    const fd = makeForm([
      ["title", "X"],
      ["slot_minutes", "60"],
      ["day_0_start", "09:00"],
    ]);
    const r = parseEventForm(fd);
    expect(r.ok).toBe(false);
  });

  it("rejects when range is shorter than the meeting length", () => {
    const fd = makeForm([
      ["title", "X"],
      ["slot_minutes", "60"],
      ["day_0_start", "09:00"],
      ["day_0_end", "09:30"],
    ]);
    const r = parseEventForm(fd);
    expect(r.ok).toBe(false);
  });

  it("rejects an invalid meeting length", () => {
    const fd = makeForm([
      ["title", "X"],
      ["slot_minutes", "17"],
      ["day_0_start", "09:00"],
      ["day_0_end", "12:00"],
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
