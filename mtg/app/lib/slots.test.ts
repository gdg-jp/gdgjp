import { describe, expect, it } from "vitest";
import { generateSlotTimes, minutesToTime, timeToMinutes } from "./slots";

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
