import type { Group, Topic } from "~/lib/topics";

/** An assignable thing: a standalone topic or a merged group of topics. */
export type Unit = {
  kind: "topic" | "group";
  /** topic id (kind "topic") or group id (kind "group"). */
  id: string;
  /** Earliest member submission time — the FCFS tie-breaker. */
  createdAt: number;
  /** Member topic ids (one for a standalone topic). */
  memberIds: string[];
};

/**
 * Collapse topics + groups into assignable units. Grouped topics fold into one
 * unit per group; ungrouped topics each become their own unit. Groups with no
 * members are dropped.
 */
export function buildUnits(topics: Topic[], groups: Group[]): Unit[] {
  const membersByGroup = new Map<string, Topic[]>();
  const standalone: Topic[] = [];
  for (const t of topics) {
    if (t.groupId) {
      const list = membersByGroup.get(t.groupId) ?? [];
      list.push(t);
      membersByGroup.set(t.groupId, list);
    } else {
      standalone.push(t);
    }
  }

  const units: Unit[] = [];
  for (const g of groups) {
    const members = membersByGroup.get(g.id);
    if (!members || members.length === 0) continue;
    units.push({
      kind: "group",
      id: g.id,
      createdAt: Math.min(...members.map((m) => m.createdAt)),
      memberIds: members.map((m) => m.id),
    });
  }
  for (const t of standalone) {
    units.push({ kind: "topic", id: t.id, createdAt: t.createdAt, memberIds: [t.id] });
  }
  return units;
}

/** A unit's score is the SUM of its member topics' vote counts. */
export function scoreUnit(unit: Unit, voteCounts: Record<string, number>): number {
  let total = 0;
  for (const id of unit.memberIds) total += voteCounts[id] ?? 0;
  return total;
}
