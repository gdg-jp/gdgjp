import {
  type AvailabilityValue,
  DEFAULT_LEVEL,
  DEFAULT_PREF,
  type Level,
  type Pref,
} from "./types";
import type { AvailabilityInput, SkillInput } from "./validate";

export function parseSkillsFromForm(
  form: FormData,
  allowedRoleIds: readonly string[],
): SkillInput[] {
  const out: SkillInput[] = [];
  for (const roleId of allowedRoleIds) {
    if (form.get(`role_${roleId}`) !== "on") continue;
    const level = String(form.get(`level_${roleId}`) ?? DEFAULT_LEVEL) as Level;
    const pref = Number(form.get(`pref_${roleId}`) ?? DEFAULT_PREF) as Pref;
    out.push({ roleId, level, pref });
  }
  return out;
}

export function parseAvailabilityFromForm(
  form: FormData,
  timeSlotIds: readonly string[],
): AvailabilityInput[] {
  const out: AvailabilityInput[] = [];
  for (const timeSlotId of timeSlotIds) {
    const raw = form.get(`avail_${timeSlotId}`);
    if (raw == null) continue;
    out.push({ timeSlotId, value: String(raw) as AvailabilityValue });
  }
  return out;
}
