import type {
  ApplicationRecord,
  ApplicationSkillRecord,
  AvailabilityRecord,
  AvailabilityValue,
  Level,
} from "~/features/applications/types";
import type { Demand } from "~/features/demand/types";

/**
 * The demand-vs-applications cross-check (docs/roster/05-staff-supply-
 * demand.md "Design" §1, docs/roster/index.md §5.8). Pure — no D1, no React
 * — so the one rule this whole stage exists for can be pinned with unit
 * tests independent of how the caller loaded the rows.
 *
 * This is a rough upper-bound estimate, not a guarantee of assignability:
 * the same applicant can cover several roles, so "3 candidates for
 * reception, 2 for stream" does not mean 5 people can be placed
 * simultaneously. Whether an actual assignment exists is Stage 06's solver's
 * job — `supply.server.ts`'s callers must show this caveat in the UI rather
 * than imply this module answers it.
 *
 * `supply/` imports `~/features/demand` and `~/features/applications` (the
 * intentional direction per the stage doc's "Design" §5) — neither of those
 * features may import back from here.
 */

/**
 * Per-role shortage for one (time slot, role) pair, aggregated across every
 * track that role has demand in. `head` and `lead` are never both reported
 * for the same pair — see `roleShortage`'s doc comment, which is the actual
 * implementation of that rule.
 */
export type RoleShortage =
  | { roleId: string; kind: "head"; lack: number }
  | { roleId: string; kind: "lead"; lack: number };

/**
 * UI label for a shortage's `kind` (docs/roster/05-staff-supply-demand.md
 * "Design" §3): "頭数" for `head`, "経験者" for `lead`. Shared by
 * `SupplyDemandRow`'s per-slot badge ("頭数: 配信 2名不足") and
 * `ShortageSummary`'s recruiting-announcement list ("配信の経験者").
 */
export const SHORTAGE_KIND_LABELS: Record<RoleShortage["kind"], string> = {
  head: "頭数",
  lead: "経験者",
};

/** One time slot's supply-vs-demand snapshot. */
export type SlotSupplyDemand = {
  timeSlotId: string;
  /** Sum of `min` across every (track, role) demand row for this slot. */
  need: number;
  /** Staff not withdrawn and not `x` for this slot — regardless of role. */
  available: number;
  tight: RoleShortage[];
};

/**
 * One applicant's supply-side facts, assembled by `supply.server.ts` from
 * `~/features/applications`' D1 rows — never written here.
 *
 * `skills` is keyed by roleId; a role with no entry is a role the applicant
 * can't take (docs/roster/index.md §3 — there is no "unable" `pref` value,
 * so absence itself is the signal). `availability` is keyed by timeSlotId; a
 * time slot with no entry is treated the same as `"x"` (unavailable) rather
 * than assumed available — e.g. a slot added to the grid after this
 * applicant last saved their availability grid must never silently count as
 * a candidate.
 */
export type SupplyApplicant = {
  applicationId: string;
  withdrawn: boolean;
  skills: ReadonlyMap<string, Level>;
  availability: ReadonlyMap<string, AvailabilityValue>;
};

/** Withdrawn applicants and `x`/unspecified slots never count as available (docs/roster/05-staff-supply-demand.md "制約"). */
/**
 * Builds one applicant's `SupplyApplicant` from the domain records Stage
 * 04's reads already produce (`~/features/applications`'
 * `ApplicationRecord`/`ApplicationSkillRecord`/`AvailabilityRecord`) — the
 * only place a real `SupplyApplicant` is constructed. `supply.server.ts`
 * calls this once per applicant; `Pick` keeps the dependency to exactly the
 * fields used, so an unrelated field rename on those types can't break this
 * mapping silently.
 */
export function toSupplyApplicant(
  application: Pick<ApplicationRecord, "id" | "withdrawn">,
  skills: readonly Pick<ApplicationSkillRecord, "roleId" | "level">[],
  availability: readonly Pick<AvailabilityRecord, "timeSlotId" | "value">[],
): SupplyApplicant {
  return {
    applicationId: application.id,
    withdrawn: application.withdrawn,
    skills: new Map(skills.map((s) => [s.roleId, s.level])),
    availability: new Map(availability.map((a) => [a.timeSlotId, a.value])),
  };
}

function isAvailable(applicant: SupplyApplicant, timeSlotId: string): boolean {
  if (applicant.withdrawn) return false;
  const value: AvailabilityValue = applicant.availability.get(timeSlotId) ?? "x";
  return value !== "x";
}

function canTakeRole(applicant: SupplyApplicant, roleId: string): boolean {
  return !applicant.withdrawn && applicant.skills.has(roleId);
}

/**
 * roleId -> summed (min, leadMin) across every track's demand row for one
 * time slot. Tracks (including the `shared` "全体" track) are a separate
 * axis from role-level supply — the same role's demand in two different
 * tracks is the same headcount need, not two independent ones (docs/roster/
 * 05-staff-supply-demand.md "前提として確認済みの事実").
 */
function aggregateRoleDemand(
  demandsForSlot: readonly Demand[],
): Map<string, { min: number; leadMin: number }> {
  const byRole = new Map<string, { min: number; leadMin: number }>();
  for (const d of demandsForSlot) {
    const entry = byRole.get(d.roleId) ?? { min: 0, leadMin: 0 };
    entry.min += d.min;
    entry.leadMin += d.leadMin;
    byRole.set(d.roleId, entry);
  }
  return byRole;
}

/**
 * The rule this whole stage exists for (docs/roster/05-staff-supply-
 * demand.md "Design" §1, "回帰として固定すべきテスト"): a role can look
 * fully staffed by headcount while having nobody who marked `lead` for it.
 * **`head` and `lead` are never both reported for the same (slot, role)** —
 * headcount takes priority; only once `can >= roleMin` does a lead shortfall
 * get surfaced. Reporting both would blur the recruiting message ("募集の
 * 打ち手がぼやける"). Returns `null` when the role is fully staffed by both
 * measures, or has no minimum requirement at all (`roleMin === 0`).
 */
function roleShortage(
  roleId: string,
  roleMin: number,
  roleLeadMin: number,
  can: number,
  canLead: number,
): RoleShortage | null {
  if (roleMin === 0) return null;
  if (can < roleMin) return { roleId, kind: "head", lack: roleMin - can };
  if (canLead < roleLeadMin) return { roleId, kind: "lead", lack: roleLeadMin - canLead };
  return null;
}

/** One time slot's full supply-vs-demand snapshot, across every role demanded in it. */
export function computeSlotSupplyDemand(
  timeSlotId: string,
  demandsForSlot: readonly Demand[],
  applicants: readonly SupplyApplicant[],
): SlotSupplyDemand {
  const need = demandsForSlot.reduce((sum, d) => sum + d.min, 0);
  const available = applicants.filter((a) => isAvailable(a, timeSlotId)).length;

  const tight: RoleShortage[] = [];
  for (const [roleId, { min, leadMin }] of aggregateRoleDemand(demandsForSlot)) {
    const eligible = applicants.filter((a) => isAvailable(a, timeSlotId) && canTakeRole(a, roleId));
    const can = eligible.length;
    const canLead = eligible.filter((a) => a.skills.get(roleId) === "lead").length;
    const shortage = roleShortage(roleId, min, leadMin, can, canLead);
    if (shortage) tight.push(shortage);
  }

  return { timeSlotId, need, available, tight };
}

/** Every time slot's supply-vs-demand snapshot, in the given slot order (idx order, per the caller). */
export function computeSupplyDemand(
  timeSlotIds: readonly string[],
  demands: readonly Demand[],
  applicants: readonly SupplyApplicant[],
): SlotSupplyDemand[] {
  const bySlot = new Map<string, Demand[]>();
  for (const d of demands) {
    const list = bySlot.get(d.timeSlotId);
    if (list) list.push(d);
    else bySlot.set(d.timeSlotId, [d]);
  }
  return timeSlotIds.map((id) => computeSlotSupplyDemand(id, bySlot.get(id) ?? [], applicants));
}

/** One (role, kind) shortage, event-wide — the unit `summarizeShortages` dedupes to. */
export type ShortageSummaryEntry = { roleId: string; kind: RoleShortage["kind"] };

/**
 * Unique (role, kind) shortages across the whole event, in first-seen slot
 * order — the "募集告知にそのまま貼れる粒度" summary (docs/roster/05-staff-
 * supply-demand.md "Design" §3): "配信の経験者が不足" should appear once for
 * the event, not once per short time slot.
 */
export function summarizeShortages(slots: readonly SlotSupplyDemand[]): ShortageSummaryEntry[] {
  const seen = new Set<string>();
  const out: ShortageSummaryEntry[] = [];
  for (const slot of slots) {
    for (const shortage of slot.tight) {
      const key = `${shortage.roleId}:${shortage.kind}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ roleId: shortage.roleId, kind: shortage.kind });
    }
  }
  return out;
}
