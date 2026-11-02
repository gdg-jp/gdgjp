import { describe, expect, it } from "vitest";
import type { Segment } from "~/features/prizes/odds";
import { type LandingPlan, planLanding } from "./staging";

// The pointer meets slices in falling index order: 3 → 2 → 1 → 0 → 5 → 4 → 3.
const segments: Segment[] = [
  { prizeId: "lose", label: "ハズレ", size: 13, tone: "neutral" },
  { prizeId: "pixel", label: "Pixel", size: 13, tone: "jackpot" },
  { prizeId: "lose", label: "ハズレ", size: 13, tone: "neutral" },
  { prizeId: "sticker", label: "ステッカー", size: 13, tone: "blue" },
  { prizeId: "lose", label: "ハズレ", size: 13, tone: "neutral" },
  { prizeId: "lose", label: "ハズレ", size: 13, tone: "neutral" },
];

/** A small seeded generator, so the share checks are repeatable. */
function seeded(seed: number) {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) % 2 ** 31;
    return state / 2 ** 31;
  };
}

function many(drawn: Parameters<typeof planLanding>[1], runs = 2000) {
  const random = seeded(7);
  return Array.from({ length: runs }, () => planLanding(segments, drawn, random));
}

const share = (plans: LandingPlan[], test: (plan: LandingPlan) => boolean) =>
  plans.filter(test).length / plans.length;

describe("planLanding", () => {
  it("always gives a prize a reach that ends in its slice", () => {
    const plans = many({ prizeId: "pixel", tier: "jackpot" });
    for (const plan of plans) {
      expect(plan.index).toBe(1);
      expect(plan.variant === "reach" || plan.variant === "revive").toBe(true);
      expect(plan.level).not.toBeNull();
    }
    // Mostly gold for the jackpot, and sometimes a revival.
    expect(share(plans, (p) => p.level === "gold")).toBeGreaterThan(0.5);
    expect(share(plans, (p) => p.variant === "revive")).toBeCloseTo(0.3, 1);
  });

  it("crawls just over the line on a reach", () => {
    for (const plan of many({ prizeId: "sticker", tier: "win" }))
      if (plan.variant === "reach") expect(plan.fraction).toBeGreaterThan(0.8);
  });

  it("stops a revival just short, on the slice before the prize", () => {
    const plan = planLanding(segments, { prizeId: "pixel", tier: "jackpot" }, seeded(1), {
      variant: "revive",
    });
    expect(plan.fakeStop?.index).toBe(2);
    expect(plan.fakeStop?.fraction).toBeLessThan(0.15);
  });

  it("stops a fake reach just short of a prize, the jackpot first", () => {
    const plans = many({ prizeId: "lose", tier: "lose" });
    const fakes = plans.filter((p) => p.variant === "fake");
    expect(fakes.length / plans.length).toBeCloseTo(0.3, 1);
    for (const plan of fakes) {
      expect(plan.index).toBe(2);
      expect(plan.fraction).toBeLessThan(0.15);
    }
    for (const plan of plans) expect(segments[plan.index]?.prizeId).toBe("lose");
  });

  it("finishes plainly when nothing was drawn or there is no near miss", () => {
    expect(planLanding(segments, null, seeded(2)).variant).toBe("plain");
    const allLose = segments.map((s) => ({ ...s, prizeId: "lose", tone: "neutral" as const }));
    const plan = planLanding(allLose, { prizeId: "lose", tier: "lose" }, seeded(3), {
      variant: "fake",
    });
    expect(plan.variant).toBe("plain");
  });

  it("can be forced, for trying the effects", () => {
    const plan = planLanding(segments, { prizeId: "sticker", tier: "win" }, seeded(4), {
      variant: "revive",
      level: "gold",
    });
    expect(plan).toMatchObject({ index: 3, variant: "revive", level: "gold" });
  });
});
