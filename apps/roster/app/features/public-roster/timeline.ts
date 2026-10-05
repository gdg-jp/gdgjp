import type { PublicAssignment } from "./types";

/**
 * Pure per-person timeline assembly for the public individual view
 * (docs/roster/09-share-public-views.md "Design" §2c) — the screen this
 * whole stage exists for. No D1, no React: `PersonTimeline.tsx` calls this
 * with the already-loaded `PublicRosterData` slices.
 *
 * Two rules the stage doc calls out explicitly, both load-bearing here:
 *  - **Consecutive slots with the same (track, role) merge into one entry.**
 *    Mirrors `~/features/roster/grid.ts#buildRoleGridColumn`'s merge idea,
 *    but keyed on ONE person's own assignment per slot rather than a whole
 *    cell's membership.
 *  - **A gap (no assignment) becomes an explicit `"break"` entry, never a
 *    silent absence** — and a merged range's `companionIds` is the UNION of
 *    everyone who shared any slot in that range, not just the first slot's
 *    occupants, so someone who took over partway through still gets listed.
 */

export type TimelineSlotRef = { id: string; idx: number; start: string; end: string };

export type TimelineItem =
  | {
      kind: "assigned";
      start: string;
      end: string;
      trackId: string;
      roleId: string;
      /** Everyone else assigned to this same (track, role) in any slot of
       * this merged range — sorted for stable rendering/testing. Never
       * includes `applicationId` itself. */
      companionIds: string[];
    }
  | { kind: "break"; start: string; end: string };

function cellKey(slotId: string, trackId: string, roleId: string): string {
  return `${slotId}|${trackId}|${roleId}`;
}

function sameAssignment(
  a: { trackId: string; roleId: string } | null,
  b: { trackId: string; roleId: string } | null,
): boolean {
  if (a === null || b === null) return a === b;
  return a.trackId === b.trackId && a.roleId === b.roleId;
}

/**
 * `slots` should be the event's full time-slot list (idx ascending — Stage
 * 02 guarantees idx is 0-based and contiguous, docs/roster/index.md §4), not
 * pre-filtered to only this person's assigned slots — a break needs to see
 * the slots on either side of it to render as a distinct item.
 */
export function buildPersonTimeline(
  slots: readonly TimelineSlotRef[],
  assignments: readonly PublicAssignment[],
  applicationId: string,
): TimelineItem[] {
  const sorted = [...slots].sort((a, b) => a.idx - b.idx);

  const ownBySlot = new Map<string, { trackId: string; roleId: string }>();
  const occupantsByCell = new Map<string, Set<string>>();
  for (const a of assignments) {
    if (a.applicationId === applicationId) {
      ownBySlot.set(a.timeSlotId, { trackId: a.trackId, roleId: a.roleId });
    }
    const key = cellKey(a.timeSlotId, a.trackId, a.roleId);
    const set = occupantsByCell.get(key);
    if (set) set.add(a.applicationId);
    else occupantsByCell.set(key, new Set([a.applicationId]));
  }

  const items: TimelineItem[] = [];
  let i = 0;
  while (i < sorted.length) {
    const own = ownBySlot.get(sorted[i].id) ?? null;
    let j = i + 1;
    while (
      j < sorted.length &&
      sameAssignment(own, ownBySlot.get(sorted[j].id) ?? null) &&
      sorted[j].idx === sorted[j - 1].idx + 1
    ) {
      j++;
    }
    const range = sorted.slice(i, j);
    const start = range[0].start;
    const end = range[range.length - 1].end;

    if (own) {
      const companions = new Set<string>();
      for (const slot of range) {
        for (const occupant of occupantsByCell.get(cellKey(slot.id, own.trackId, own.roleId)) ??
          []) {
          if (occupant !== applicationId) companions.add(occupant);
        }
      }
      items.push({
        kind: "assigned",
        start,
        end,
        trackId: own.trackId,
        roleId: own.roleId,
        companionIds: [...companions].sort(),
      });
    } else {
      items.push({ kind: "break", start, end });
    }
    i = j;
  }
  return items;
}
