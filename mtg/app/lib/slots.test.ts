import { describe, expect, it } from "vitest";
import { deriveDayRanges, generateSlotTimes, minutesToTime, timeToMinutes } from "./slots";

describe("timeToMinutes / minutesToTime", () => {
  it("round-trips", () => {
    expect(timeToMinutes("00:00")).toBe(0);
    expect(timeToMinutes("09:30")).toBe(570);
    expect(timeToMinutes("23:59")).toBe(1439);
    expect(minutesToTime(0)).toBe("00:00");
    expect(minutesToTime(570)).toBe("09:30");
    expect(minutesToTime(1439)).toBe("23:59");
  });
});

describe("generateSlotTimes", () => {
  it("emits starts where the meeting fits", () => {
    expect(generateSlotTimes("09:00", "12:00", 60)).toEqual(["09:00", "10:00", "11:00"]);
  });

  it("respects 30-minute increments", () => {
    expect(generateSlotTimes("09:00", "10:30", 30)).toEqual(["09:00", "09:30", "10:00"]);
  });

  it("returns empty when range is shorter than the meeting", () => {
    expect(generateSlotTimes("09:00", "09:30", 60)).toEqual([]);
  });

  it("handles exact-fit ranges", () => {
    expect(generateSlotTimes("09:00", "10:00", 60)).toEqual(["09:00"]);
  });
});

describe("deriveDayRanges", () => {
  it("groups contiguous slots into a single range", () => {
    const days = deriveDayRanges(
      [
        { dayOfWeek: 0, startTime: "19:00" },
        { dayOfWeek: 0, startTime: "20:00" },
        { dayOfWeek: 0, startTime: "21:00" },
      ],
      60,
    );
    expect(days[0].ranges).toEqual([{ start: "19:00", end: "22:00" }]);
    for (let i = 1; i < 7; i++) expect(days[i].ranges).toEqual([]);
  });

  it("splits non-contiguous slots into separate ranges", () => {
    const days = deriveDayRanges(
      [
        { dayOfWeek: 2, startTime: "10:00" },
        { dayOfWeek: 2, startTime: "14:00" },
      ],
      30,
    );
    expect(days[2].ranges).toEqual([
      { start: "10:00", end: "10:30" },
      { start: "14:00", end: "14:30" },
    ]);
  });

  it("handles exact-fit single-slot ranges", () => {
    const days = deriveDayRanges([{ dayOfWeek: 1, startTime: "09:00" }], 60);
    expect(days[1].ranges).toEqual([{ start: "09:00", end: "10:00" }]);
  });

  it("leaves all days empty when there are no slots", () => {
    const days = deriveDayRanges([], 60);
    expect(days).toHaveLength(7);
    for (const d of days) expect(d.ranges).toEqual([]);
  });
});
