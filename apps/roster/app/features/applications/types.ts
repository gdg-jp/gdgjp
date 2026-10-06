/**
 * Shared vocabulary for the applications domain (docs/roster/index.md §3
 * "経験レベル" / "希望度" / "稼働可否", §4 "applications" / "application_skills"
 * / "availabilities"). Values and labels are copied verbatim from the spec —
 * do not invent new levels/prefs/availability values or reword the labels,
 * the solver (Stage 06) and the public form both depend on these exact
 * strings.
 */

export const LEVELS = ["lead", "exp", "new"] as const;
export type Level = (typeof LEVELS)[number];

export const LEVEL_LABELS: Record<Level, string> = {
  lead: "リード",
  exp: "経験あり",
  new: "初参加",
};

/** Shown next to each level in the apply form so self-reporting is consistent. */
export const LEVEL_DESCRIPTIONS: Record<Level, string> = {
  lead: "その役割を単独で回せる。初参加者を指導できる",
  exp: "単独で担当できる",
  new: "サポートが必要",
};

export const DEFAULT_LEVEL: Level = "new";

export const PREFS = [1, 2] as const;
export type Pref = (typeof PREFS)[number];

export const PREF_LABELS: Record<Pref, string> = {
  1: "第1希望",
  2: "可",
};

export const DEFAULT_PREF: Pref = 2;

export const AVAILABILITY_VALUES = ["o", "d", "x"] as const;
export type AvailabilityValue = (typeof AVAILABILITY_VALUES)[number];

export const AVAILABILITY_LABELS: Record<AvailabilityValue, string> = {
  o: "○",
  d: "△",
  x: "×",
};

/**
 * The staff-facing form asks only for the slots someone cannot (`x`) or would rather not (`d`)
 * work. A slot left unselected is saved as `o`, so the stored values above do not change.
 */
export const UNAVAILABILITY_CHOICES = [
  { value: "d", label: "△ できれば避けたい" },
  { value: "x", label: "× 参加できない" },
] as const satisfies readonly { value: Exclude<AvailabilityValue, "o">; label: string }[];

/** The "△ is only used when available staff don't fill the slot" caveat the form must show. */
export const UNAVAILABILITY_HINT = "△ は、参加できる人で埋まらない場合にだけ割り当てられます。";

export const PARTY_STATUSES = ["yes", "no", "undecided"] as const;
export type PartyStatus = (typeof PARTY_STATUSES)[number];

export const PARTY_LABELS: Record<PartyStatus, string> = {
  yes: "参加",
  no: "不参加",
  undecided: "未定",
};

export const DEFAULT_PARTY: PartyStatus = "undecided";

export const UPDATED_BY_VALUES = ["self", "owner"] as const;
export type UpdatedBy = (typeof UPDATED_BY_VALUES)[number];

/** The staff list's "最終更新" column (docs/roster/05-staff-supply-demand.md "Design" §2). */
export const UPDATED_BY_LABELS: Record<UpdatedBy, string> = {
  self: "本人",
  owner: "オーナー",
};

/** A staff registration for one event (docs/roster/index.md §4 "applications"). */
export type ApplicationRecord = {
  id: string;
  eventId: string;
  userId: string | null;
  email: string;
  name: string;
  contact: string | null;
  party: PartyStatus;
  note: string | null;
  withdrawn: boolean;
  updatedBy: UpdatedBy;
  createdAt: string;
  updatedAt: string;
};

/** One (application × role) row — omitted entirely for roles the applicant can't take. */
export type ApplicationSkillRecord = {
  applicationId: string;
  roleId: string;
  level: Level;
  pref: Pref;
};

/** One (application × time_slot) row. */
export type AvailabilityRecord = {
  applicationId: string;
  timeSlotId: string;
  value: AvailabilityValue;
};
