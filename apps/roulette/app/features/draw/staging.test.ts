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

function many(drawn: Parameters<typeof planLanding>[1], runs = 4000) {
  const random = seeded(7);
  return Array.from({ length: runs }, () => planLanding(segments, drawn, random));
}

const share = (plans: LandingPlan[], test: (plan: LandingPlan) => boolean) =>
  plans.filter(test).length / plans.length;

describe("planLanding", () => {
  it("always gives a prize a crawl that ends in its slice", () => {
    const plans = many({ prizeId: "pixel", tier: "jackpot" });
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

  it("pushes from a slice next to a different prize when the prize repeats", () => {
    const repeated: Segment[] = [
      { prizeId: "lose", label: "ハズレ", size: 13, tone: "neutral" },
      { prizeId: "sticker", label: "ステッカー", size: 13, tone: "blue" },
      { prizeId: "sticker", label: "ステッカー", size: 13, tone: "blue" },
      { prizeId: "sticker", label: "ステッカー", size: 13, tone: "blue" },
    ];
    for (let seed = 0; seed < 50; seed += 1) {
      const plan = planLanding(repeated, { prizeId: "sticker", tier: "win" }, seeded(seed), {
        variant: "push",
      });
      expect(plan).toMatchObject({ index: 3, variant: "push", fakeStop: { index: 0 } });
    }
  });

  it("crawls just over the line unless a button sends it in", () => {
    for (const plan of many({ prizeId: "sticker", tier: "win" }))
      if (plan.variant !== "push") expect(plan.fraction).toBeGreaterThan(0.8);
  });

  it("stops a push just short, on the slice before the prize", () => {
    const plan = planLanding(segments, { prizeId: "pixel", tier: "jackpot" }, seeded(1), {
      variant: "push",
    });
    expect(plan.variant).toBe("push");
    expect(plan.fakeStop?.index).toBe(2);
    expect(plan.fakeStop?.fraction).toBeLessThan(0.15);
  });

  it("gives some losses a crawl that stops just short of a prize, the jackpot first", () => {
    const plans = many({ prizeId: "lose", tier: "lose" });
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
    const pushed = planLanding(segments, { prizeId: "lose", tier: "lose" }, seeded(5), {
      variant: "push",
    });
    expect(pushed.variant).toBe("plain");
    const rainbow = planLanding(segments, { prizeId: "lose", tier: "lose" }, seeded(5), {
      variant: "renda",
      level: "rainbow",
    });
    expect(rainbow).toMatchObject({ variant: "renda", nearMiss: true });
    expect(rainbow.level).not.toBe("rainbow");
  });

  it("finishes plainly when nothing was drawn or there is no near miss", () => {
    expect(planLanding(segments, null, seeded(2)).variant).toBe("plain");
    const allLose = segments.map((s) => ({ ...s, prizeId: "lose", tone: "neutral" as const }));
    const plan = planLanding(allLose, { prizeId: "lose", tier: "lose" }, seeded(3), {
      variant: "renda",
    });
    expect(plan.variant).toBe("plain");
  });

  it("can be forced, for trying the effects", () => {
    const plan = planLanding(segments, { prizeId: "sticker", tier: "win" }, seeded(4), {
      variant: "renda",
      level: "rainbow",
    });
    expect(plan).toMatchObject({ index: 3, variant: "renda", level: "rainbow" });
  });
});
