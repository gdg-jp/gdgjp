/** How the next prize is chosen. See currentOdds in odds.ts. */
export type Mode = "standard" | "custom" | "evil";

export const MODES: readonly Mode[] = ["standard", "custom", "evil"];

export type Prize = {
  id: string;
  name: string;
  /** null is unlimited — the losing slot (ハズレ). */
  stock: number | null;
  won: number;
  /** Chance in % for the custom mode. */
  percent: number;
  /** Never drawn, though still shown to visitors. Only ever set in the evil mode. */
  excluded: boolean;
};

/** How loud the result effect is: the top finite prize, other finite prizes, unlimited. */
export type Tier = "jackpot" | "win" | "lose";

export const MAX_PRIZES = 15;
