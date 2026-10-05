import { describe, expect, it } from "vitest";
import { matchStaffIds, normalizeName } from "./search";

const STAFF = [
  { id: "a1", name: "佐藤 陽菜" },
  { id: "a2", name: "鈴木 大輝" },
  { id: "a3", name: "佐藤 蓮" },
  { id: "a4", name: "Alice Nguyen" },
];

describe("normalizeName", () => {
  it("lowercases and removes every space, not just the ends", () => {
    expect(normalizeName("  Alice  Nguyen ")).toBe("alicenguyen");
    expect(normalizeName("佐藤 陽菜")).toBe("佐藤陽菜");
  });

  it("removes full-width spaces too — a Japanese name is often typed with one", () => {
    expect(normalizeName("佐藤　陽菜")).toBe("佐藤陽菜");
  });

  it("folds katakana to hiragana — which one a person types is a habit, not a distinction", () => {
    expect(normalizeName("サトウ")).toBe(normalizeName("さとう"));
    expect(normalizeName("ヴァイオリン")).toBe(normalizeName("ゔぁいおりん"));
  });

  it("folds width via NFKC, so an IME's full-width latin still matches", () => {
    expect(normalizeName("Ａｌｉｃｅ")).toBe("alice");
    expect(normalizeName("ｶﾄｳ")).toBe(normalizeName("かとう"));
  });

  it("leaves kanji alone", () => {
    expect(normalizeName("加藤")).toBe("加藤");
  });
});

describe("matchStaffIds", () => {
  it("matches on a partial name", () => {
    expect(matchStaffIds("佐藤", STAFF)).toEqual(new Set(["a1", "a3"]));
  });

  it("matches a full name typed without the registered space", () => {
    expect(matchStaffIds("佐藤陽菜", STAFF)).toEqual(new Set(["a1"]));
  });

  it("is case-insensitive", () => {
    expect(matchStaffIds("alice", STAFF)).toEqual(new Set(["a4"]));
    expect(matchStaffIds("NGUYEN", STAFF)).toEqual(new Set(["a4"]));
  });

  it("returns an empty set for a blank query — never every row", () => {
    // The result drives a highlight; matching everything when the box is
    // empty would light up the whole grid.
    expect(matchStaffIds("", STAFF)).toEqual(new Set());
    expect(matchStaffIds("   ", STAFF)).toEqual(new Set());
  });

  it("returns an empty set when nothing matches", () => {
    expect(matchStaffIds("田中", STAFF)).toEqual(new Set());
  });

  it("finds a katakana-registered name typed in hiragana", () => {
    const staff = [{ id: "k1", name: "サトウ ハルナ" }];
    expect(matchStaffIds("さとう", staff)).toEqual(new Set(["k1"]));
    expect(matchStaffIds("ハルナ", staff)).toEqual(new Set(["k1"]));
  });
});
