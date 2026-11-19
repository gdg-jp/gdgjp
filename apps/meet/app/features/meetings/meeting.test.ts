import { describe, expect, it } from "vitest";
import {
  formatMeetingDateTimeRange,
  getDefaultMeetingSchedule,
  localDateTimeToUtcIso,
  splitMeetingsByTime,
} from "./meeting";

describe("localDateTimeToUtcIso", () => {
  it("Asia/Tokyo のローカル日時を UTC ISO 8601 へ変換する", () => {
    expect(localDateTimeToUtcIso("2026-12-01", "19:00", "Asia/Tokyo")).toBe(
      "2026-12-01T10:00:00.000Z",
    );
  });

  it("UTC のローカル日時をそのまま変換する", () => {
    expect(localDateTimeToUtcIso("2026-12-01", "09:30", "UTC")).toBe("2026-12-01T09:30:00.000Z");
  });

  it("存在しない日付や不正なタイムゾーンは null を返す", () => {
    expect(localDateTimeToUtcIso("2026-02-30", "10:00", "Asia/Tokyo")).toBeNull();
    expect(localDateTimeToUtcIso("2026-12-01", "25:00", "Asia/Tokyo")).toBeNull();
    expect(localDateTimeToUtcIso("2026-12-01", "10:00", "Invalid/Zone")).toBeNull();
  });
});

describe("getDefaultMeetingSchedule", () => {
  it("次の正時から 1 時間の初期値を返す", () => {
    // 2026-12-01T10:15:00Z = 2026-12-01 19:15 JST → 20:00〜21:00 JST
    const schedule = getDefaultMeetingSchedule(new Date("2026-12-01T10:15:00.000Z"), "Asia/Tokyo");
    expect(schedule).toEqual({
      date: "2026-12-01",
      startTime: "20:00",
      endTime: "21:00",
    });
  });

  it("23 時台など日付をまたぐ場合は同日 22:00〜23:00 に丸める", () => {
    // 2026-12-01T13:30:00Z = 2026-12-01 22:30 JST → 次の正時 23:00〜00:00 を 22:00〜23:00 へ丸め
    const schedule = getDefaultMeetingSchedule(new Date("2026-12-01T13:30:00.000Z"), "Asia/Tokyo");
    expect(schedule).toEqual({
      date: "2026-12-01",
      startTime: "22:00",
      endTime: "23:00",
    });
  });
});

describe("formatMeetingDateTimeRange", () => {
  it("同日の会議を日本語の日時範囲に整形する", () => {
    const formatted = formatMeetingDateTimeRange(
      "2026-12-01T10:00:00.000Z",
      "2026-12-01T11:30:00.000Z",
      "Asia/Tokyo",
    );
    expect(formatted).toContain("19:00〜20:30");
  });
});

describe("splitMeetingsByTime", () => {
  it("終了前を今後の会議（昇順）、終了済みを過去の会議（降順）へ分ける", () => {
    const { upcoming, past } = splitMeetingsByTime(
      [
        { id: "p1", startAt: "2026-11-01T10:00:00.000Z", endAt: "2026-11-01T11:00:00.000Z" },
        { id: "p2", startAt: "2026-11-10T10:00:00.000Z", endAt: "2026-11-10T11:00:00.000Z" },
        { id: "u2", startAt: "2026-12-10T10:00:00.000Z", endAt: "2026-12-10T11:00:00.000Z" },
        { id: "u1", startAt: "2026-12-01T10:00:00.000Z", endAt: "2026-12-01T11:00:00.000Z" },
      ],
      "2026-11-19T00:00:00.000Z",
    );
    expect(upcoming.map((m) => m.id)).toEqual(["u1", "u2"]);
    expect(past.map((m) => m.id)).toEqual(["p2", "p1"]);
  });
});
