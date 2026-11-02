import { type Segment, mod } from "~/features/prizes/odds";
import type { Tier } from "~/features/prizes/prize";

/**
 * How a spin finishes, pachinko style. Pure, so how often each effect shows is
 * testable. The server has already picked the prize; none of this changes it.
 *
 * - crawl: a CHANCE cut-in, then a crawl over the last slices.
 * - renda (連打): a crawl that asks for rapid taps. The taps fill a gauge and
 *   nothing else.
 * - push (押せ): prizes only. Stops just short, goes dark, and a PUSH button
 *   sends it on into the prize.
 *
 * Every prize gets a crawl; some losses get one too and stop just short of a
 * prize. The cut-in color hints at the outcome: blue, red, gold, and rainbow
 * (prizes only, so it settles it).
 */

export type CutInLevel = "blue" | "red" | "gold" | "rainbow";
export type Variant = "plain" | "crawl" | "renda" | "push";

export const LEVELS: readonly CutInLevel[] = ["blue", "red", "gold", "rainbow"];
export const VARIANTS: readonly Variant[] = ["plain", "crawl", "renda", "push"];

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
  /** A loss that stops just short of a prize. */
  nearMiss: boolean;
  /** Push only: where the wheel stops before the button sends it on. */
  fakeStop: Stop | null;
};

const levelShares: Record<Tier, [CutInLevel, number][]> = {
  jackpot: [
    ["rainbow", 0.15],
    ["gold", 0.5],
    ["red", 0.25],
    ["blue", 0.1],
  ],
  win: [
    ["rainbow", 0.05],
    ["gold", 0.1],
    ["red", 0.4],
    ["blue", 0.45],
  ],
  lose: [
    ["gold", 0.03],
    ["red", 0.22],
    ["blue", 0.75],
  ],
};

const pushShare: Record<Tier, number> = { jackpot: 0.3, win: 0.15, lose: 0 };
/** Losses that still get a crawl. */
const LOSE_CRAWL_SHARE = 0.3;
/** Crawls that ask for rapid taps. */
const RENDA_SHARE = 0.5;

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
    nearMiss: false,
    fakeStop: null,
  });
  const anywhere = Math.floor(random() * Math.max(count, 1));
  const matches = drawn ? segments.flatMap((s, i) => (s.prizeId === drawn.prizeId ? [i] : [])) : [];
  const index = pick(matches, random);
  // A crawl needs a few slices to cross.
  if (!drawn || index === undefined || count < 3 || force.variant === "plain")
    return plain(index ?? anywhere);
  const at = (i: number) => segments[mod(i, count)];
  const crawl = (): Variant => (random() < RENDA_SHARE ? "renda" : "crawl");

  if (drawn.tier === "lose") {
    // Slices the pointer would reach a prize right after.
    const nearMiss = matches.filter((i) => at(i - 1)?.tone !== "neutral");
    const best = nearMiss.filter((i) => at(i - 1)?.tone === "jackpot");
    const stop = pick(best.length ? best : nearMiss, random);
    const wanted = force.variant ?? (random() < LOSE_CRAWL_SHARE ? crawl() : "plain");
    // A button press always pays out, so a loss never gets one.
    if (stop === undefined || wanted === "plain" || wanted === "push") return plain(index);
    const level =
      force.level && force.level !== "rainbow" ? force.level : pickLevel("lose", random);
    return {
      index: stop,
      fraction: between(random, 0.05, 0.12),
      variant: wanted,
      level,
      nearMiss: true,
      fakeStop: null,
    };
  }

  const level = force.level ?? pickLevel(drawn.tier, random);
  const variant = force.variant ?? (random() < pushShare[drawn.tier] ? "push" : crawl());
  // Push stops on the slice the pointer meets just before the prize, so that one must differ.
  const pushable = matches.filter((i) => at(i + 1)?.prizeId !== drawn.prizeId);
  const pushTo = pick(pushable, random);
  if (variant === "push" && pushTo !== undefined)
    return {
      index: pushTo,
      fraction: between(random, 0.35, 0.65),
      variant,
      level,
      nearMiss: false,
      fakeStop: { index: mod(pushTo + 1, count), fraction: between(random, 0.05, 0.12) },
    };
  return {
    index,
    fraction: between(random, 0.82, 0.92),
    variant: variant === "push" ? "crawl" : variant,
    level,
    nearMiss: false,
    fakeStop: null,
  };
}
