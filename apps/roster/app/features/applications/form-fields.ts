import {
  type AvailabilityValue,
  DEFAULT_LEVEL,
  DEFAULT_PREF,
  type Level,
  type Pref,
} from "./types";
import type { AvailabilityInput, SkillInput } from "./validate";

/**
 * Shared `FormData` <-> field-naming contract between
 * `components/RoleSkillRow.tsx` / `components/AvailabilityGrid.tsx` (which
 * set these `name` attributes) and both routes that submit this shape
 * (`routes/apply.$token.tsx` for self-registration, `routes/e.$id.staff.tsx`
 * for proxy-add). Keeping the parse side here instead of duplicated in each
 * route means the naming convention only has one place to change.
 *
 * A role/time-slot not present in `allowedRoleIds`/`timeSlotIds` is never
 * read even if a crafted request includes it — the caller passes exactly
 * the event's actual `event_roles`/`time_slots` ids, so this doubles as a
 * first filter before `validate.ts` runs.
 */

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
