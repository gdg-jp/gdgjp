import { describe, expect, it } from "vitest";
import type { Segment } from "~/features/prizes/odds";
import { type LandingPlan, planLanding } from "./staging";

// The pointer meets slices in falling index order: 3 → 2 → 1 → 0 → 5 → 4 → 3.
const slice = (prizeId: string, rank: number | null): Segment => ({
  prizeId,
  label: prizeId,
  size: 13,
  tone: rank === null ? "neutral" : rank === 1 ? "jackpot" : "blue",
  rank,
});

const segments: Segment[] = [
  slice("lose", null),
  slice("pixel", 1),
  slice("lose", null),
  slice("sticker", 2),
  slice("lose", null),
  slice("lose", null),
];

const pixel = { prizeId: "pixel", tier: "jackpot", rank: 1 } as const;
const sticker = { prizeId: "sticker", tier: "win", rank: 2 } as const;
const lose = { prizeId: "lose", tier: "lose", rank: null } as const;

/** A small seeded generator, so the share checks are repeatable. */
function seeded(seed: number) {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) % 2 ** 31;
    return state / 2 ** 31;
  };
}

function many(drawn: Parameters<typeof planLanding>[1], runs = 4000) {
  const random = seeded(7);
  return Array.from({ length: runs }, () => planLanding(segments, drawn, random));
}

const share = (plans: LandingPlan[], test: (plan: LandingPlan) => boolean) =>
  plans.filter(test).length / plans.length;

describe("planLanding", () => {
  it("always gives a prize a crawl that ends in its slice", () => {
    const plans = many(pixel);
    for (const plan of plans) {
      expect(plan.index).toBe(1);
      expect(plan.variant).not.toBe("plain");
      expect(plan.level).not.toBeNull();
      expect(plan.nearMiss).toBe(false);
    }
    expect(share(plans, (p) => p.level === "gold")).toBeCloseTo(0.5, 1);
    expect(share(plans, (p) => p.level === "rainbow")).toBeCloseTo(0.15, 1);
    expect(share(plans, (p) => p.variant === "push")).toBeCloseTo(0.3, 1);
    expect(share(plans, (p) => p.variant === "renda")).toBeCloseTo(0.35, 1);
  });

  it("stops short on a lesser prize next to the prize when the prize repeats", () => {
    const repeated = [slice("lose", null), ...[1, 2, 3].map(() => slice("sticker", 2))];
    for (let seed = 0; seed < 50; seed += 1) {
      const plan = planLanding(repeated, sticker, seeded(seed), { variant: "push" });
      expect(plan).toMatchObject({ index: 3, variant: "push", fakeStop: { index: 0 } });
    }
  });

  it("stops short on the nearest lesser prize when there is no ハズレ", () => {
    // Met in order 3 → 2 → 1 → 0: 2 等, 3 等, 2 等, 1 等.
    const ranked = [slice("first", 1), slice("second", 2), slice("third", 3), slice("second", 2)];
    const second = { prizeId: "second", tier: "win", rank: 2 } as const;
    for (let seed = 0; seed < 50; seed += 1) {
      // Slice 1 has 3 等 right before it; slice 3 would have to jump over 1 等 and 2 等.
      const plan = planLanding(ranked, second, seeded(seed), { variant: "renda" });
      expect(plan).toMatchObject({ index: 1, variant: "renda", fakeStop: { index: 2 } });
    }
    const first = { prizeId: "first", tier: "jackpot", rank: 1 } as const;
    const jackpot = planLanding(ranked, first, seeded(1), { variant: "renda" });
    expect(jackpot).toMatchObject({ index: 0, fakeStop: { index: 1 } });
    // Nothing ranks below 3 等, so it crawls in instead.
    const third = { prizeId: "third", tier: "win", rank: 3 } as const;
    const lowest = planLanding(ranked, third, seeded(1), { variant: "renda" });
    expect(lowest).toMatchObject({ index: 2, variant: "crawl", fakeStop: null });
  });

  it("crawls just over the line, or stops short on a losing slice and jolts in", () => {
    for (const plan of many(sticker)) {
      if (plan.variant === "crawl") expect(plan.fraction).toBeGreaterThan(0.8);
      else {
        expect(plan.variant === "renda" || plan.variant === "push").toBe(true);
        expect(plan.fakeStop).toEqual({ index: 4, fraction: expect.any(Number) });
        expect(segments[plan.fakeStop?.index ?? -1]?.tone).toBe("neutral");
      }
    }
  });

  it("stops a push just short, on the slice before the prize", () => {
    const plan = planLanding(segments, pixel, seeded(1), {
      variant: "push",
    });
    expect(plan.variant).toBe("push");
    expect(plan.fakeStop?.index).toBe(2);
    expect(plan.fakeStop?.fraction).toBeLessThan(0.25);
  });

  it("gives some losses a crawl that stops just short of a prize, the jackpot first", () => {
    const plans = many(lose);
    const crawls = plans.filter((p) => p.variant !== "plain");
    expect(crawls.length / plans.length).toBeCloseTo(0.3, 1);
    for (const plan of crawls) {
      expect(plan.nearMiss).toBe(true);
      expect(plan.index).toBe(2);
      expect(plan.fraction).toBeLessThan(0.15);
    }
    for (const plan of plans) {
      expect(segments[plan.index]?.prizeId).toBe("lose");
      expect(plan.variant).not.toBe("push");
      expect(plan.level).not.toBe("rainbow");
    }
  });

  it("never gives a loss a push or a rainbow, even when forced", () => {
    const pushed = planLanding(segments, lose, seeded(5), {
      variant: "push",
    });
    expect(pushed.variant).toBe("plain");
    const rainbow = planLanding(segments, lose, seeded(5), {
      variant: "renda",
      level: "rainbow",
    });
    expect(rainbow).toMatchObject({ variant: "renda", nearMiss: true });
    expect(rainbow.level).not.toBe("rainbow");
  });

  it("finishes plainly when nothing was drawn or there is no near miss", () => {
    expect(planLanding(segments, null, seeded(2)).variant).toBe("plain");
    const allLose = segments.map(() => slice("lose", null));
    const plan = planLanding(allLose, lose, seeded(3), {
      variant: "renda",
    });
    expect(plan.variant).toBe("plain");
  });

  it("can be forced, for trying the effects", () => {
    const plan = planLanding(segments, sticker, seeded(4), {
      variant: "renda",
      level: "rainbow",
    });
    expect(plan).toMatchObject({ index: 3, variant: "renda", level: "rainbow" });
  });
});
