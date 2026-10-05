import {
  AVAILABILITY_VALUES,
  type AvailabilityValue,
  LEVELS,
  type Level,
  PARTY_STATUSES,
  PREFS,
  type PartyStatus,
  type Pref,
} from "./types";

/**
 * Pure validation for the `/apply/:applyToken` form (docs/roster/04-
 * applications.md "Design" §2 "入力項目"). No D1, no auth — the route
 * gathers `allowedRoleIds` (the event's `event_roles`) and `timeSlotIds`
 * (the event's `time_slots`) once and passes them in, so this stays a
 * pure function testable without touching the database.
 */

export type SkillInput = { roleId: string; level: Level; pref: Pref };
export type AvailabilityInput = { timeSlotId: string; value: AvailabilityValue };

export type ApplyFormInput = {
  name: string;
  contact: string;
  party: PartyStatus;
  note: string;
  skills: SkillInput[];
  availability: AvailabilityInput[];
};

export type ApplyFormContext = {
  /** `event.hasParty` — when false the party field isn't asked and isn't validated. */
  hasParty: boolean;
  allowedRoleIds: ReadonlySet<string>;
  timeSlotIds: ReadonlySet<string>;
};

/**
 * Every time slot must have an availability entry (docs/roster/04-
 * applications.md "Design" §2 lists it as 必須) — an omitted slot isn't
 * "unspecified", it just wouldn't exist for the solver to read.
 */
export function validateApplyForm(input: ApplyFormInput, ctx: ApplyFormContext): string[] {
  const errors: string[] = [];

  if (!input.name.trim()) errors.push("表示名を入力してください。");

  if (input.skills.length === 0) {
    errors.push("担当できる役割を1つ以上選んでください。");
  }
  const seenRoles = new Set<string>();
  for (const skill of input.skills) {
    if (!ctx.allowedRoleIds.has(skill.roleId)) {
      errors.push("担当できる役割に不明な値が含まれています。");
    }
    if (seenRoles.has(skill.roleId)) {
      errors.push("同じ役割が重複して指定されています。");
    }
    seenRoles.add(skill.roleId);
    if (!(LEVELS as readonly string[]).includes(skill.level)) {
      errors.push("経験レベルの値が不正です。");
    }
    if (!(PREFS as readonly number[]).includes(skill.pref)) {
      errors.push("希望度の値が不正です。");
    }
  }

  const seenSlots = new Set<string>();
  for (const entry of input.availability) {
    if (!ctx.timeSlotIds.has(entry.timeSlotId)) {
      errors.push("稼働可能時間に不明な時間枠が含まれています。");
    }
    if (seenSlots.has(entry.timeSlotId)) {
      errors.push("同じ時間枠が重複して指定されています。");
    }
    seenSlots.add(entry.timeSlotId);
    if (!(AVAILABILITY_VALUES as readonly string[]).includes(entry.value)) {
      errors.push("稼働可否の値が不正です。");
    }
  }
  if ([...ctx.timeSlotIds].some((id) => !seenSlots.has(id))) {
    errors.push("すべての時間枠について稼働可否を入力してください。");
  }

  if (ctx.hasParty && !(PARTY_STATUSES as readonly string[]).includes(input.party)) {
    errors.push("懇親会の参加可否の値が不正です。");
  }

  return errors;
}
