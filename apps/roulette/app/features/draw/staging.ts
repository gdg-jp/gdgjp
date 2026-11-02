import { type Segment, mod } from "~/features/prizes/odds";
import type { Tier } from "~/features/prizes/prize";

/**
 * How a spin finishes. Pure, so how often each effect shows is testable.
 *
 * - reach (リーチ): a cut-in, then a crawl over the last slices. Every prize
 *   gets one, crawling just over the line into its slice.
 * - fake: a loss that gets a reach anyway and stops just short of a prize.
 * - revive (復活): stops just short, goes quiet, then jolts on into the prize.
 *
 * The cut-in color hints at the outcome without giving it away.
 */

export type CutInLevel = "blue" | "red" | "gold";
export type Variant = "plain" | "reach" | "fake" | "revive";

export const LEVELS: readonly CutInLevel[] = ["blue", "red", "gold"];
export const VARIANTS: readonly Variant[] = ["plain", "reach", "fake", "revive"];

export type Stop = {
  index: number;
  /**
   * The share of the slice still to pass the pointer: near 1 has just come
   * in, near 0 is about to move on to slice `index − 1`.
   */
  fraction: number;
};

export type LandingPlan = Stop & {
  variant: Variant;
  level: CutInLevel | null;
  /** Revive only: where the wheel stops before jolting on to the prize. */
  fakeStop: Stop | null;
};

const levelShares: Record<Tier, [CutInLevel, number][]> = {
  jackpot: [
    ["gold", 0.6],
    ["red", 0.3],
    ["blue", 0.1],
  ],
  win: [
    ["gold", 0.1],
    ["red", 0.45],
    ["blue", 0.45],
  ],
  lose: [
    ["gold", 0.03],
    ["red", 0.22],
    ["blue", 0.75],
  ],
};

const reviveShare: Record<Tier, number> = { jackpot: 0.3, win: 0.15, lose: 0 };
const FAKE_SHARE = 0.3;

function pick<T>(items: T[], random: () => number): T | undefined {
  return items[Math.floor(random() * items.length)];
}

function between(random: () => number, low: number, high: number) {
  return low + random() * (high - low);
}

function pickLevel(tier: Tier, random: () => number): CutInLevel {
  let point = random();
  for (const [level, share] of levelShares[tier]) {
    point -= share;
    if (point < 0) return level;
  }
  return "blue";
}

export function planLanding(
  segments: Segment[],
  drawn: { prizeId: string | null; tier: Tier } | null,
  random: () => number,
  force: { variant?: Variant; level?: CutInLevel } = {},
): LandingPlan {
  const count = segments.length;
  const plain = (index: number): LandingPlan => ({
    index,
    fraction: between(random, 0.15, 0.85),
    variant: "plain",
    level: null,
    fakeStop: null,
  });
  const anywhere = Math.floor(random() * Math.max(count, 1));
  const matches = drawn ? segments.flatMap((s, i) => (s.prizeId === drawn.prizeId ? [i] : [])) : [];
  const index = pick(matches, random);
  // A crawl needs a few slices to cross.
  if (!drawn || index === undefined || count < 3) return plain(index ?? anywhere);
  const level = force.level ?? pickLevel(drawn.tier, random);
  const at = (i: number) => segments[mod(i, count)];

  if (drawn.tier === "lose") {
    // Slices the pointer would reach a prize right after.
    const nearMiss = matches.filter((i) => at(i - 1)?.tone !== "neutral");
    const best = nearMiss.filter((i) => at(i - 1)?.tone === "jackpot");
    const fake = force.variant ? force.variant === "fake" : random() < FAKE_SHARE;
    const stop = pick(best.length ? best : nearMiss, random);
    if (!fake || stop === undefined) return plain(index);
    return {
      index: stop,
      fraction: between(random, 0.05, 0.12),
      variant: "fake",
      level,
      fakeStop: null,
    };
  }

  if (force.variant === "plain") return plain(index);
  // The slice that passes the pointer just before this one.
  const before = mod(index + 1, count);
  const revive = force.variant ? force.variant === "revive" : random() < reviveShare[drawn.tier];
  if (revive && at(before)?.prizeId !== drawn.prizeId)
    return {
      index,
      fraction: between(random, 0.35, 0.65),
      variant: "revive",
      level,
      fakeStop: { index: before, fraction: between(random, 0.05, 0.12) },
    };
  return { index, fraction: between(random, 0.82, 0.92), variant: "reach", level, fakeStop: null };
}
