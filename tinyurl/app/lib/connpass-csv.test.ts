import { describe, expect, it } from "vitest";
import {
  eventIdFromFilename,
  isCancelledParticipant,
  parseConnpassDate,
  parseConnpassParticipantsCsv,
  parseCsv,
  splitAnswerOptions,
  uniqueAnswerOptions,
  uniqueAnswers,
} from "./connpass-csv";

describe("parseCsv", () => {
  it("handles BOM, CRLF, commas, escaped quotes, and newlines in quoted fields", () => {
    expect(parseCsv('\ufeffa,b\r\n1,"two, too"\r\n2,"say ""hi""\nnext"\r\n')).toEqual([
      ["a", "b"],
      ["1", "two, too"],
      ["2", 'say "hi"\nnext'],
    ]);
  });

  it("rejects an unterminated quoted field", () => {
    expect(() => parseCsv('a,"broken')).toThrow("引用符");
  });
});

describe("parseConnpassParticipantsCsv", () => {
  const csv = [
    "参加枠名,ユーザー名,どこからこのイベントを知りましたか？,更新日時,受付番号",
    '現地参加,user1,"X, Discord",2026年4月19日 17時22分,6844623',
    "配信参加,user2,知人から,2026年4月20日 09時05分,6844624",
  ].join("\r\n");

  it("separates questionnaire columns and mechanically reads participant metadata", () => {
    const parsed = parseConnpassParticipantsCsv(csv);
    expect(parsed.questionHeaders).toEqual(["どこからこのイベントを知りましたか？"]);
    expect(parsed.participants[0]).toMatchObject({
      participantId: "6844623",
      participationType: "現地参加",
      participationStatus: "",
      registeredAt: 1776586920,
      registeredAtLabel: "2026年4月19日 17時22分",
      lastUpdatedAt: 1776586920,
      lastUpdatedAtLabel: "2026年4月19日 17時22分",
      responses: { "どこからこのイベントを知りましたか？": "X, Discord" },
    });
    expect(uniqueAnswers(parsed.participants, parsed.questionHeaders[0])).toEqual([
      "X, Discord",
      "知人から",
    ]);
    expect(uniqueAnswerOptions(parsed.participants, parsed.questionHeaders[0])).toEqual([
      "X",
      "Discord",
      "知人から",
    ]);
  });

  it("treats 更新日時 as registration time and identifies cancelled rows", () => {
    const parsed = parseConnpassParticipantsCsv(
      [
        "参加枠名,参加ステータス,更新日時,受付番号",
        "現地参加,参加,2026年4月19日 17時22分,1",
        "現地参加,参加キャンセル,2026年4月20日 09時05分,2",
      ].join("\n"),
    );
    expect(parsed.participants[0].registeredAt).toBe(1776586920);
    expect(isCancelledParticipant(parsed.participants[0])).toBe(false);
    expect(isCancelledParticipant(parsed.participants[1])).toBe(true);
  });

  it("requires connpass metadata columns", () => {
    expect(() => parseConnpassParticipantsCsv("foo,bar\na,b")).toThrow("必要な列");
  });

  it("rejects rows whose width differs from the header", () => {
    expect(() =>
      parseConnpassParticipantsCsv("参加枠名,更新日時,受付番号\n現地,2026年4月19日 17時22分"),
    ).toThrow("列数");
  });
});

describe("connpass helpers", () => {
  it("parses connpass JST timestamps as unix seconds", () => {
    expect(parseConnpassDate("2026年4月19日 17時22分")).toBe(1776586920);
    expect(parseConnpassDate("2026年2月31日 17時22分")).toBeNull();
    expect(parseConnpassDate("2026-04-19T17:22:00")).toBeNull();
    expect(parseConnpassDate("2026-04-19T17:22:00+09:00")).toBe(1776586920);
  });

  it("extracts an event id from a connpass export filename", () => {
    expect(eventIdFromFilename("event_391029_participants.csv")).toBe("391029");
    expect(eventIdFromFilename("participants.csv")).toBeNull();
  });

  it("splits multi-select answers into unique options", () => {
    expect(splitAnswerOptions("X, Instagram、Discord / connpass\n知人から")).toEqual([
      "X",
      "Instagram",
      "Discord",
      "connpass",
      "知人から",
    ]);
  });
});
