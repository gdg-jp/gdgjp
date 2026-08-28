import { type Unit, scoreUnit } from "~/lib/scoring";
import type { Desk } from "~/lib/topics";

/**
 * Rank units for desk assignment: highest total votes first, ties broken by
 * earliest submission (first-come-first-served), then by id for determinism.
 */
export function rankUnits(units: Unit[], voteCounts: Record<string, number>): Unit[] {
  return [...units].sort((a, b) => {
    const sa = scoreUnit(a, voteCounts);
    const sb = scoreUnit(b, voteCounts);
    if (sa !== sb) return sb - sa;
    if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

/**
 * Zip ranked units onto desks (ordered by `sortOrder`). Stops at the shorter
 * list: extra units stay unassigned, extra desks stay empty.
 * Returns deskId -> unitId.
 */
export function autoAssign(ranked: Unit[], desks: Desk[]): Map<string, string> {
  const ordered = [...desks].sort((a, b) => a.sortOrder - b.sortOrder);
  const out = new Map<string, string>();
  const n = Math.min(ordered.length, ranked.length);
  for (let i = 0; i < n; i++) {
    out.set(ordered[i].id, ranked[i].id);
  }
  return out;
}
