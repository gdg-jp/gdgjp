import type { Desk } from "~/features/board/protocol";
import { type Unit, scoreUnit } from "~/features/board/scoring";

export function rankUnits(units: Unit[], voteCounts: Record<string, number>): Unit[] {
  return [...units].sort((a, b) => {
    const sa = scoreUnit(a, voteCounts);
    const sb = scoreUnit(b, voteCounts);
    if (sa !== sb) return sb - sa;
    if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

export function autoAssign(ranked: Unit[], desks: Desk[]): Map<string, string> {
  const ordered = [...desks].sort((a, b) => a.sortOrder - b.sortOrder);
  const out = new Map<string, string>();
  const n = Math.min(ordered.length, ranked.length);
  for (let i = 0; i < n; i++) {
    out.set(ordered[i].id, ranked[i].id);
  }
  return out;
}
