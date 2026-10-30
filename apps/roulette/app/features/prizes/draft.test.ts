import { describe, expect, it } from "vitest";
import {
  type Draft,
  type DraftPrize,
  addRow,
  boxPool,
  draftRank,
  draftToSettings,
  hasErrors,
  moveRow,
  parseDraft,
  previewOdds,
  toDraft,
  validateDraft,
} from "./draft";
import type { Prize } from "./prize";

const saved: Prize[] = [
  { id: "pixel", name: "Google Pixel 10", stock: 1, won: 0, percent: 5, excluded: false },
  { id: "sticker", name: "ステッカー", stock: 30, won: 12, percent: 45, excluded: false },
  { id: "lose", name: "ハズレ", stock: null, won: 20, percent: 50, excluded: false },
];

const base = (): Draft => toDraft({ mode: "custom", expected: 100, prizes: saved });

function patch(draft: Draft, index: number, change: Partial<DraftPrize>): Draft {
  return {
    ...draft,
    prizes: draft.prizes.map((row, i) => (i === index ? { ...row, ...change } : row)),
  };
}

describe("validateDraft", () => {
  it("accepts the saved settings", () => {
    expect(validateDraft(base(), saved)).toEqual({});
  });

  it("flags an empty name on its row", () => {
    const draft = patch(base(), 0, { name: "  " });
    expect(validateDraft(draft, saved).name).toEqual({ pixel: "景品名を入れてください" });
  });

  it("does not let the stock drop below what was already won", () => {
    const draft = patch(base(), 1, { stockText: "10" });
    expect(validateDraft(draft, saved).stock).toEqual({
      sticker: "当選済みの 12 個より減らせません",
    });
  });

  it("requires the % to add up to 100 for custom", () => {
    const draft = patch(base(), 2, { percentText: "45" });
    expect(validateDraft(draft, saved).list).toBe("確率の合計を 100% にしてください（今は 95%）");
    expect(previewOdds(draft, saved, 32)).toBeNull();
  });

  it("ignores the % for other modes", () => {
    const draft = { ...patch(base(), 2, { percentText: "abc" }), mode: "standard" as const };
    expect(hasErrors(validateDraft(draft, saved))).toBe(false);
  });

  it("needs an expected count of at least the stock with an unlimited prize", () => {
    const draft = { ...base(), mode: "standard" as const, expectedText: "20" };
    expect(validateDraft(draft, saved).expected).toBe(
      "景品の個数の合計（31 個）以上にしてください",
    );
    expect(validateDraft({ ...draft, expectedText: "" }, saved).expected).toBe(
      "想定人数を入れてください",
    );
  });

  it("needs the evil mode to exclude some prizes but not all", () => {
    const evil = { ...base(), mode: "evil" as const };
    expect(validateDraft(evil, saved).list).toBe(
      "悪徳モードでは、出さない景品を 1 つ以上選んでください",
    );
    const all = { ...evil, prizes: evil.prizes.map((row) => ({ ...row, excluded: true })) };
    expect(validateDraft(all, saved).list).toBe("出す景品を 1 つ以上残してください");
    expect(validateDraft(patch(evil, 0, { excluded: true }), saved)).toEqual({});
  });

  it("needs at least one prize", () => {
    expect(validateDraft({ ...base(), prizes: [] }, saved).list).toBe(
      "景品を 1 つ以上登録してください",
    );
  });
});

describe("rows", () => {
  it("adds new rows above the losing slot", () => {
    const draft = addRow(base(), "new");
    expect(draft.prizes.map((row) => row.id)).toEqual(["pixel", "sticker", "new", "lose"]);
    expect(draftRank(draft, 2)).toBe(3);
    expect(draftRank(draft, 3)).toBeNull();
  });

  it("moves rows", () => {
    expect(moveRow(base(), 0, 1).prizes.map((row) => row.id)).toEqual(["sticker", "pixel", "lose"]);
  });
});

describe("box preview", () => {
  it("counts what the losing slot stands for now", () => {
    const draft = { ...base(), mode: "standard" as const, expectedText: "120" };
    // 120 − 32 drawn − (1 + 18) finite left
    expect(boxPool(draft, saved, 32)).toBe(69);
  });
});

describe("parseDraft", () => {
  it("round-trips a draft", () => {
    const draft = base();
    expect(parseDraft(JSON.parse(JSON.stringify(draft)))).toEqual(draft);
  });

  it("rejects bad shapes", () => {
    expect(parseDraft(null)).toBeNull();
    expect(parseDraft({ ...base(), mode: "lottery" })).toBeNull();
    expect(parseDraft(patch(base(), 0, { excluded: "yes" as unknown as boolean }))).toBeNull();
    expect(parseDraft(patch(base(), 1, { id: "pixel" }))).toBeNull();
    expect(parseDraft(patch(base(), 0, { id: "x'; DROP TABLE prize" }))).toBeNull();
  });
});

describe("draftToSettings", () => {
  it("keeps what was won and trims names", () => {
    const draft = patch(base(), 0, { name: " Pixel " });
    expect(draftToSettings(draft, saved).prizes[1]).toEqual(saved[1]);
    expect(draftToSettings(draft, saved).prizes[0]?.name).toBe("Pixel");
  });

  it("keeps excluded rows only in the evil mode", () => {
    const draft = patch(base(), 0, { excluded: true });
    expect(draftToSettings(draft, saved).prizes[0]?.excluded).toBe(false);
    expect(draftToSettings({ ...draft, mode: "evil" }, saved).prizes[0]?.excluded).toBe(true);
  });
});
