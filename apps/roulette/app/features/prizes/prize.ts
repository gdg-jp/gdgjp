/** How the next prize is chosen. See odds.ts. */
export type Method = "fixed" | "box" | "equal";

export const METHODS: readonly Method[] = ["fixed", "box", "equal"];

export type Prize = {
  id: string;
  name: string;
  /** null is unlimited — the losing slot (ハズレ). */
  stock: number | null;
  won: number;
  /** Chance in % for the "fixed" method. */
  percent: number;
};

/** How loud the result effect is: the top finite prize, other finite prizes, unlimited. */
export type Tier = "jackpot" | "win" | "lose";

export const MAX_PRIZES = 15;
