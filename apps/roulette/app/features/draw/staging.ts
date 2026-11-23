import { type Segment, mod } from "~/features/prizes/odds";
import type { Tier } from "~/features/prizes/prize";

export type CutInLevel = "blue" | "red" | "gold" | "rainbow";
export type Variant = "plain" | "crawl" | "renda" | "push";

export const LEVELS: readonly CutInLevel[] = ["blue", "red", "gold", "rainbow"];
export const VARIANTS: readonly Variant[] = ["plain", "crawl", "renda", "push"];

export type Stop = {
  index: number;
  fraction: number;
};

export type LandingPlan = Stop & {
  variant: Variant;
  level: CutInLevel | null;
  nearMiss: boolean;
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
const LOSE_CRAWL_SHARE = 0.3;
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
  drawn: { prizeId: string | null; tier: Tier; rank: number | null } | null,
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
  if (!drawn || index === undefined || count < 3 || force.variant === "plain")
    return plain(index ?? anywhere);
  const at = (i: number) => segments[mod(i, count)];
  const crawl = (): Variant => (random() < RENDA_SHARE ? "renda" : "crawl");

  if (drawn.tier === "lose") {
    const nearMiss = matches.filter((i) => at(i - 1)?.tone !== "neutral");
    const best = nearMiss.filter((i) => at(i - 1)?.tone === "jackpot");
    const stop = pick(best.length ? best : nearMiss, random);
    const wanted = force.variant ?? (random() < LOSE_CRAWL_SHARE ? crawl() : "plain");
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
  const lesser = (i: number) => {
    const slice = at(i);
    return slice?.rank === null || (slice !== undefined && slice.rank > (drawn.rank ?? 0));
  };
  const gaps = matches.map((i) => {
    let gap = 1;
    while (gap < count && !lesser(i + gap)) gap += 1;
    return { i, gap };
  });
  const nearest = Math.min(...gaps.map(({ gap }) => gap));
  const jump =
    nearest < count
      ? pick(
          gaps.filter(({ gap }) => gap === nearest),
          random,
        )
      : undefined;
  if ((variant === "push" || variant === "renda") && jump)
    return {
      index: jump.i,
      fraction: between(random, 0.35, 0.65),
      variant,
      level,
      nearMiss: false,
      fakeStop: { index: mod(jump.i + jump.gap, count), fraction: between(random, 0.12, 0.22) },
    };
  return {
    index,
    fraction: between(random, 0.82, 0.92),
    variant: "crawl",
    level,
    nearMiss: false,
    fakeStop: null,
  };
}
