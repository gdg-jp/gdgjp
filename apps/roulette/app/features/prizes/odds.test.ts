import { describe, expect, it } from "vitest";
import {
  configuredWeights,
  currentOdds,
  formatOdds,
  pickPrize,
  rankOf,
  rotationFor,
  segmentsFor,
  tierOf,
} from "./odds";
import type { Prize } from "./prize";

const prizes: Prize[] = [
  { id: "pixel", name: "Google Pixel 10", stock: 1, won: 0, percent: 1 },
  { id: "hub", name: "Google Nest Hub", stock: 2, won: 1, percent: 9 },
  { id: "lose", name: "ハズレ", stock: null, won: 20, percent: 90 },
];

describe("rankOf / tierOf", () => {
  it("ranks finite prizes from the top and skips unlimited ones", () => {
    const mixed: Prize[] = [
      { id: "a", name: "A", stock: null, won: 0, percent: 0 },
      { id: "b", name: "B", stock: 3, won: 0, percent: 0 },
      { id: "c", name: "C", stock: 3, won: 0, percent: 0 },
    ];
    expect(rankOf(mixed, "a")).toBeNull();
    expect(rankOf(mixed, "b")).toBe(1);
    expect(rankOf(mixed, "c")).toBe(2);
    expect(tierOf(mixed, "a")).toBe("lose");
    expect(tierOf(mixed, "b")).toBe("jackpot");
    expect(tierOf(mixed, "c")).toBe("win");
  });
});

describe("currentOdds", () => {
  it("uses the configured % for fixed", () => {
    expect(currentOdds(prizes, "fixed", 0, 21)).toEqual([0.01, 0.09, 0.9]);
  });

  it("hands a sold-out prize's share to the rest pro rata", () => {
    const soldOut = prizes.map((prize) => (prize.id === "hub" ? { ...prize, won: 2 } : prize));
    const odds = currentOdds(soldOut, "fixed", 0, 22);
    expect(odds[1]).toBe(0);
    expect(odds[0]).toBeCloseTo(1 / 91);
    expect(odds[2]).toBeCloseTo(90 / 91);
  });

  it("counts tickets left in the box", () => {
    // 100 expected, 21 drawn, 2 finite left → 77 losing tickets.
    const odds = currentOdds(prizes, "box", 100, 21);
    expect(odds[0]).toBeCloseTo(1 / 79);
    expect(odds[1]).toBeCloseTo(1 / 79);
    expect(odds[2]).toBeCloseTo(77 / 79);
  });

  it("only draws unlimited prizes once the box is past the expected count", () => {
    const odds = currentOdds(prizes, "box", 10, 30);
    // The pool is empty but finite prizes are still in the box.
    expect(odds[2]).toBe(0);
    const empty = prizes.map((prize) =>
      prize.stock === null ? prize : { ...prize, won: prize.stock },
    );
    expect(currentOdds(empty, "box", 10, 30)).toEqual([0, 0, 1]);
  });

  it("splits equally among prizes in stock", () => {
    const odds = currentOdds(prizes, "equal", 0, 0);
    expect(odds).toEqual([1 / 3, 1 / 3, 1 / 3]);
  });

  it("is all zeros when everything is gone", () => {
    const gone: Prize[] = [{ id: "a", name: "A", stock: 1, won: 1, percent: 100 }];
    for (const method of ["fixed", "box", "equal"] as const)
      expect(currentOdds(gone, method, 10, 1)).toEqual([0]);
  });

  it("falls back to equal when every prize left is 0%", () => {
    const zero: Prize[] = [
      { id: "a", name: "A", stock: 1, won: 1, percent: 100 },
      { id: "b", name: "B", stock: 5, won: 0, percent: 0 },
    ];
    expect(currentOdds(zero, "fixed", 0, 1)).toEqual([0, 1]);
  });
});

describe("pickPrize", () => {
  it("maps the random number onto the odds", () => {
    const odds = [0.01, 0.09, 0.9];
    expect(pickPrize(prizes, odds, () => 0)).toBe("pixel");
    expect(pickPrize(prizes, odds, () => 0.0099)).toBe("pixel");
    expect(pickPrize(prizes, odds, () => 0.01)).toBe("hub");
    expect(pickPrize(prizes, odds, () => 0.5)).toBe("lose");
    expect(pickPrize(prizes, odds, () => 0.999999)).toBe("lose");
  });

  it("never picks a prize with no chance", () => {
    expect(pickPrize(prizes, [0, 0, 1], () => 0)).toBe("lose");
    expect(pickPrize(prizes, [0, 0, 0], () => 0.5)).toBeNull();
  });
});

describe("formatOdds", () => {
  it("formats small and large shares", () => {
    expect(formatOdds(0)).toBe("0%");
    expect(formatOdds(0.0005)).toBe("0.1% 未満");
    expect(formatOdds(0.012)).toBe("1.2%");
    expect(formatOdds(0.5)).toBe("50%");
  });
});

describe("segmentsFor", () => {
  it("gives every prize a slice and the rest by configured weight", () => {
    const segments = segmentsFor(prizes, "fixed", 0);
    expect(segments).toHaveLength(12);
    const count = (id: string) => segments.filter((s) => s.prizeId === id).length;
    expect(count("pixel")).toBe(1);
    expect(count("hub")).toBe(2);
    expect(count("lose")).toBe(9);
  });

  it("ignores what has been won, so the wheel does not reveal stock", () => {
    const soldOut = prizes.map((prize) => ({ ...prize, won: prize.stock ?? 999 }));
    expect(segmentsFor(soldOut, "fixed", 0)).toEqual(segmentsFor(prizes, "fixed", 0));
  });

  it("spreads copies of the same prize apart", () => {
    const segments = segmentsFor(prizes, "equal", 0);
    expect(segments).toHaveLength(12);
    for (let i = 0; i < segments.length; i += 1) {
      const next = segments[(i + 1) % segments.length];
      expect(segments[i]?.prizeId).not.toBe(next?.prizeId);
    }
  });

  it("keeps one slice each when there are 12 or more prizes", () => {
    const many = Array.from(
      { length: 15 },
      (_, i): Prize => ({
        id: `p${i}`,
        name: `景品 ${i}`,
        stock: 1,
        won: 0,
        percent: 0,
      }),
    );
    expect(segmentsFor(many, "equal", 0)).toHaveLength(15);
  });

  it("colors the jackpot and the losing slot", () => {
    const segments = segmentsFor(prizes, "fixed", 0);
    expect(segments.find((s) => s.prizeId === "pixel")?.tone).toBe("jackpot");
    expect(segments.find((s) => s.prizeId === "lose")?.tone).toBe("neutral");
  });

  it("shrinks, then truncates long labels", () => {
    const long: Prize[] = [
      { id: "a", name: "ステッカー", stock: 1, won: 0, percent: 0 },
      { id: "b", name: "Android ぬいぐるみ", stock: 1, won: 0, percent: 0 },
      { id: "c", name: "GDG オリジナルパーカー（L サイズ）", stock: 1, won: 0, percent: 0 },
    ];
    const labels = Object.fromEntries(
      segmentsFor(long, "equal", 0).map((s) => [s.prizeId, { label: s.label, size: s.size }]),
    );
    expect(labels.b).toEqual({ label: "Android ぬいぐるみ", size: 11 });
    expect(labels.c?.label.endsWith("…")).toBe(true);
  });
});

describe("configuredWeights", () => {
  it("counts unlimited prizes as the rest of the expected visitors in a box", () => {
    expect(configuredWeights(prizes, "box", 100)).toEqual([1, 2, 97]);
  });
});

describe("rotationFor", () => {
  it("puts the pointer (top) on the middle of a segment", () => {
    expect(rotationFor(0, 4)).toBe(315);
    expect(rotationFor(1, 4)).toBe(225);
    expect(rotationFor(0, 4, 0)).toBe(0);
  });
});
