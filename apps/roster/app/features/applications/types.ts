export const LEVELS = ["lead", "exp", "new"] as const;
export type Level = (typeof LEVELS)[number];

export const LEVEL_LABELS: Record<Level, string> = {
  lead: "リード",
  exp: "経験あり",
  new: "初参加",
};

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

export const UNAVAILABILITY_CHOICES = [
  { value: "d", label: "△ できれば避けたい" },
  { value: "x", label: "× 参加できない" },
] as const satisfies readonly { value: Exclude<AvailabilityValue, "o">; label: string }[];

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

export const UPDATED_BY_LABELS: Record<UpdatedBy, string> = {
  self: "本人",
  owner: "オーナー",
};

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

export type ApplicationSkillRecord = {
  applicationId: string;
  roleId: string;
  level: Level;
  pref: Pref;
};

export type AvailabilityRecord = {
  applicationId: string;
  timeSlotId: string;
  value: AvailabilityValue;
};
