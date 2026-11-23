import type {
  ApplicationRecord,
  ApplicationSkillRecord,
  AvailabilityRecord,
  AvailabilityValue,
  Level,
} from "~/features/applications/types";
import type { Demand } from "~/features/demand/types";

export type RoleShortage =
  | { roleId: string; kind: "head"; lack: number }
  | { roleId: string; kind: "lead"; lack: number };

export const SHORTAGE_KIND_LABELS: Record<RoleShortage["kind"], string> = {
  head: "頭数",
  lead: "経験者",
};

export type SlotSupplyDemand = {
  timeSlotId: string;
  need: number;
  available: number;
  tight: RoleShortage[];
};

export type SupplyApplicant = {
  applicationId: string;
  withdrawn: boolean;
  skills: ReadonlyMap<string, Level>;
  availability: ReadonlyMap<string, AvailabilityValue>;
};

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

export type ShortageSummaryEntry = { roleId: string; kind: RoleShortage["kind"] };

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
