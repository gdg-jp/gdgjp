import { describe, expect, it } from "vitest";
import {
  X_POST_CHARACTER_LIMIT,
  getXPostLinkRanges,
  parseXPostText,
  xCounterDisplayRemaining,
} from "./x-text";

describe("X post text", () => {
  it("uses X's weighted limit for Latin and Japanese text", () => {
    expect(parseXPostText("a".repeat(X_POST_CHARACTER_LIMIT))).toMatchObject({
      weightedLength: 280,
      valid: true,
    });
    expect(parseXPostText("あ".repeat(140))).toMatchObject({ weightedLength: 280, valid: true });
    expect(parseXPostText("あ".repeat(141))).toMatchObject({
      weightedLength: 282,
      valid: false,
    });
    const JapaneseText = "あいうえお".repeat(27);
    const JapaneseResult = parseXPostText(JapaneseText);
    expect(JapaneseResult).toMatchObject({
      weightedLength: 270,
      valid: true,
    });
    expect(xCounterDisplayRemaining(JapaneseText, JapaneseResult.weightedLength)).toBe(5);
    expect(xCounterDisplayRemaining("a".repeat(270), 270)).toBe(10);
  });

  it("counts emoji sequences as two characters", () => {
    expect(parseXPostText("👨‍👩‍👧‍👦")).toMatchObject({ weightedLength: 2, valid: true });
  });

  it("counts each detected URL as 23 characters regardless of its source length", () => {
    expect(parseXPostText("https://x.com")).toMatchObject({ weightedLength: 23, valid: true });
    expect(
      parseXPostText("https://example.com/a/very/long/path?with=query#and-fragment"),
    ).toMatchObject({
      weightedLength: 23,
      valid: true,
    });
  });

  it("finds links, mentions, and hashtags using X's entity parser", () => {
    const text = "@naokirodion https://gdgs.jp/track-tech #Xtalk26";
    const entities = getXPostLinkRanges(text).map(({ start, end }) => text.slice(start, end));

    expect(entities).toEqual(["@naokirodion", "https://gdgs.jp/track-tech", "#Xtalk26"]);
  });
});
