import type { Method, Prize, Tier } from "./prize";

/**
 * Prize odds and wheel layout. Pure: shared by the admin preview, the draw
 * action on the server, and the wheel on the spin page.
 */

export function remaining(prize: Prize) {
  return prize.stock === null ? Number.POSITIVE_INFINITY : Math.max(prize.stock - prize.won, 0);
}

/** Rank among finite prizes, counted from the top (1 等, 2 等, ...). Unlimited prizes have none. */
export function rankOf(prizes: Prize[], id: string): number | null {
  let rank = 0;
  for (const prize of prizes) {
    if (prize.stock === null) {
      if (prize.id === id) return null;
      continue;
    }
    rank += 1;
    if (prize.id === id) return rank;
  }
  return null;
}

export function tierOf(prizes: Prize[], id: string): Tier {
  const rank = rankOf(prizes, id);
  if (rank === null) return "lose";
  return rank === 1 ? "jackpot" : "win";
}

export function rankLabel(rank: number | null) {
  return rank === null ? "ハズレ" : `${rank} 等`;
}

/** Sum of what is left of the finite prizes. */
export function finiteLeft(prizes: Prize[]) {
  return prizes.reduce((sum, prize) => (prize.stock === null ? sum : sum + remaining(prize)), 0);
}

/**
 * The chance (0–1) that each prize is drawn next. All zeros means sold out.
 *
 * - fixed: the configured %; a sold-out prize's share goes to the rest pro rata.
 * - box: tickets in a box of `expected` visitors. Finite prizes count what is
 *   left; unlimited prizes share `expected − draws − finite left`. Past
 *   `expected` visitors only unlimited prizes come out.
 * - equal: every prize that is left, equally.
 */
export function currentOdds(
  prizes: Prize[],
  method: Method,
  expected: number,
  draws: number,
): number[] {
  const inStock = prizes.map((prize) => remaining(prize) > 0);
  let weights: number[];
  if (method === "fixed") {
    weights = prizes.map((prize, i) => (inStock[i] ? Math.max(prize.percent, 0) : 0));
  } else if (method === "box") {
    const unlimited = prizes.filter((prize) => prize.stock === null).length;
    const pool = Math.max(expected - draws - finiteLeft(prizes), 0);
    weights = prizes.map((prize) =>
      prize.stock === null ? (unlimited ? pool / unlimited : 0) : remaining(prize),
    );
    if (weights.every((weight) => weight === 0))
      weights = prizes.map((prize) => (prize.stock === null ? 1 : 0));
  } else {
    weights = inStock.map((ok) => (ok ? 1 : 0));
  }
  // The prizes still in stock may all be 0% under "fixed": fall back to equal.
  if (weights.every((weight) => weight === 0)) weights = inStock.map((ok) => (ok ? 1 : 0));
  return normalize(weights);
}

function normalize(weights: number[]) {
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  return weights.map((weight) => (total ? weight / total : 0));
}

export function formatOdds(value: number) {
  if (value === 0) return "0%";
  if (value < 0.001) return "0.1% 未満";
  const percent = value * 100;
  return `${percent >= 10 ? percent.toFixed(0) : percent.toFixed(1)}%`;
}

/** Pick a prize id by odds. `random` returns [0, 1). */
export function pickPrize(prizes: Prize[], odds: number[], random: () => number): string | null {
  const candidates = prizes
    .map((prize, i) => ({ id: prize.id, weight: odds[i] ?? 0 }))
    .filter(({ weight }) => weight > 0);
  const total = candidates.reduce((sum, { weight }) => sum + weight, 0);
  let point = random() * total;
  for (const { id, weight } of candidates) {
    point -= weight;
    if (point < 0) return id;
  }
  return candidates.at(-1)?.id ?? null;
}

// ---- wheel layout ----

export type SegmentTone = "jackpot" | "blue" | "red" | "green" | "neutral";

export type Segment = { prizeId: string; label: string; size: number; tone: SegmentTone };

const MIN_SEGMENTS = 12;
const cycle: SegmentTone[] = ["blue", "red", "green"];

/**
 * The prize mix as configured, ignoring what has been won. The wheel uses it so
 * visitors cannot read the remaining stock off the wheel.
 */
export function configuredWeights(prizes: Prize[], method: Method, expected: number) {
  if (method === "fixed") return prizes.map((prize) => Math.max(prize.percent, 0));
  if (method === "box") {
    const stocked = prizes.reduce((sum, prize) => sum + (prize.stock ?? 0), 0);
    const unlimited = prizes.filter((prize) => prize.stock === null).length;
    const pool = Math.max(expected - stocked, 0);
    return prizes.map((prize) => prize.stock ?? (unlimited ? pool / unlimited : 0));
  }
  return prizes.map(() => 1);
}

/**
 * Wheel segments. Every prize gets at least one; the rest of the 12 go out in
 * proportion to the configured weights, so a rare prize is one thin slice the
 * pointer can nearly hit. Copies of the same prize are spread around the rim.
 */
export function segmentsFor(prizes: Prize[], method: Method, expected: number): Segment[] {
  if (!prizes.length) return [];
  const weights = configuredWeights(prizes, method, expected);
  const counts = prizes.map(() => 1);
  const extra = Math.max(MIN_SEGMENTS - prizes.length, 0);
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  if (extra) {
    const quotas = weights.map((weight) =>
      total ? (weight / total) * extra : extra / prizes.length,
    );
    let left = extra;
    quotas.forEach((quota, i) => {
      counts[i] = (counts[i] ?? 1) + Math.floor(quota);
      left -= Math.floor(quota);
    });
    const order = quotas
      .map((quota, i) => ({ i, rest: quota - Math.floor(quota), weight: weights[i] ?? 0 }))
      .sort((a, b) => b.rest - a.rest || b.weight - a.weight);
    for (const { i } of order) {
      if (left <= 0) break;
      counts[i] = (counts[i] ?? 1) + 1;
      left -= 1;
    }
  }
  const slots = prizes.flatMap((prize, i) => {
    const count = counts[i] ?? 1;
    const offset = (i + 0.5) / prizes.length;
    return Array.from({ length: count }, (_, j) => ({ prize, key: (j + offset) / count }));
  });
  slots.sort((a, b) => a.key - b.key);
  return slots.map(({ prize }) => {
    const rank = rankOf(prizes, prize.id);
    const tone: SegmentTone =
      rank === null
        ? "neutral"
        : rank === 1
          ? "jackpot"
          : (cycle[(rank - 2) % cycle.length] ?? "blue");
    // The jackpot slice also carries a star, so its label has less room.
    return { prizeId: prize.id, tone, ...fitLabel(prize.name, tone === "jackpot" ? 7.6 : 8.6) };
  });
}

/** Display width in full-width characters (ASCII counts a little over half). */
export function textUnits(text: string) {
  let units = 0;
  for (const char of text) units += /[\x20-\x7e]/.test(char) ? 0.58 : 1;
  return units;
}

/** Fit a label in `budget` units at 13px, else 11px, else truncate at 11px. */
function fitLabel(name: string, budget: number) {
  if (textUnits(name) <= budget) return { label: name, size: 13 };
  const small = (budget * 13) / 11;
  if (textUnits(name) <= small) return { label: name, size: 11 };
  let label = "";
  for (const char of name) {
    if (textUnits(label + char) > small - 1) break;
    label += char;
  }
  return { label: `${label.trimEnd()}…`, size: 11 };
}

/** Wheel angle (degrees, clockwise) that puts the pointer at `fraction` of segment `index`. */
export function rotationFor(index: number, count: number, fraction = 0.5) {
  return mod(-(index + fraction) * (360 / count), 360);
}

export function mod(value: number, by: number) {
  return ((value % by) + by) % by;
}
