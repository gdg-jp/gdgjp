export type Medium = "x_ads" | "ig_ads" | "print";

export type AdFlight = {
  id: number;
  campaignId: number;
  medium: Medium;
  name: string;
  startAt: number;
  endAt: number;
  plannedYen: number;
  actualYen: number | null;
  phases: { fromDay: number; toDay: number; objective: string }[];
  overrunAlertedAt: number | null;
  planVersion: number | null;
};

export const MEDIUM_LABELS: Record<Medium, string> = {
  x_ads: "X 広告",
  ig_ads: "Instagram 広告",
  print: "印刷",
};

/**
 * Overrun: actual above planned × (1 + ratio), or spending faster than 1.5× the planned daily
 * pace so far (a mis-set budget burned ¥60,000 in DevFest 2026). The ratio is the Playbook's.
 */
export function overrun(
  flight: Pick<AdFlight, "plannedYen" | "actualYen" | "startAt" | "endAt">,
  ratio: number,
  now: number,
): string | null {
  const actual = flight.actualYen ?? 0;
  if (actual > flight.plannedYen * (1 + ratio))
    return `予算超過: 実績 ${actual.toLocaleString("ja-JP")} 円 / 計画 ${flight.plannedYen.toLocaleString("ja-JP")} 円`;
  const total = Math.max(1, flight.endAt - flight.startAt);
  const elapsed = Math.min(total, Math.max(0, now - flight.startAt));
  if (elapsed > 0 && elapsed < total) {
    const pace = flight.plannedYen * (elapsed / total);
    if (actual > pace * 1.5 && actual > 0)
      return `消化が早すぎる: 実績 ${actual.toLocaleString("ja-JP")} 円 / この時点の計画 ${Math.round(pace).toLocaleString("ja-JP")} 円`;
  }
  return null;
}

/** X : IG share of ad spend against constants.budget.xIgRatioRange (3 : 7 〜 4 : 6). */
export function xIgSplit(
  flights: Pick<AdFlight, "medium" | "plannedYen" | "actualYen">[],
  range: number[][],
  field: "plannedYen" | "actualYen",
) {
  const sum = (m: Medium) =>
    flights.filter((f) => f.medium === m).reduce((n, f) => n + (f[field] ?? 0), 0);
  const x = sum("x_ads");
  const ig = sum("ig_ads");
  if (x + ig === 0) return { x, ig, share: null, inRange: null };
  const share = x / (x + ig);
  const [lo, hi] = range.map(([a = 0, b = 0]) => a / (a + b)).sort((a, b) => a - b);
  return { x, ig, share, inRange: share >= (lo ?? 0) - 1e-9 && share <= (hi ?? 1) + 1e-9 };
}
