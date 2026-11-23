export type Mode = "standard" | "custom" | "evil";

export const MODES: readonly Mode[] = ["standard", "custom", "evil"];

export type Prize = {
  id: string;
  name: string;
  stock: number | null;
  won: number;
  percent: number;
  excluded: boolean;
};

export type Tier = "jackpot" | "win" | "lose";

export const MAX_PRIZES = 15;
