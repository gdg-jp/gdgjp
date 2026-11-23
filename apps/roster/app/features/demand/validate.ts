import type { DemandValue } from "./types";

export type DemandValidationError =
  | "MIN_NEGATIVE"
  | "MIN_EXCEEDS_IDEAL"
  | "LEAD_MIN_NEGATIVE"
  | "LEAD_MIN_EXCEEDS_IDEAL"
  | "NEW_MAX_NEGATIVE"
  | "IDEAL_ZERO_REQUIRES_ZEROED_FIELDS";

export function validateDemand(value: DemandValue): DemandValidationError[] {
  const errors: DemandValidationError[] = [];

  if (value.min < 0) errors.push("MIN_NEGATIVE");
  if (value.min > value.ideal) errors.push("MIN_EXCEEDS_IDEAL");
  if (value.leadMin < 0) errors.push("LEAD_MIN_NEGATIVE");
  if (value.leadMin > value.ideal) errors.push("LEAD_MIN_EXCEEDS_IDEAL");
  if (value.newMax < 0) errors.push("NEW_MAX_NEGATIVE");

  if (value.ideal === 0 && (value.min !== 0 || value.leadMin !== 0 || value.newMax !== 0)) {
    errors.push("IDEAL_ZERO_REQUIRES_ZEROED_FIELDS");
  }

  return errors;
}

export function isValidDemand(value: DemandValue): boolean {
  return validateDemand(value).length === 0;
}

export const DEMAND_VALIDATION_MESSAGES: Record<DemandValidationError, string> = {
  MIN_NEGATIVE: "最小人数は0以上にしてください。",
  MIN_EXCEEDS_IDEAL: "最小人数は理想人数以下にしてください。",
  LEAD_MIN_NEGATIVE: "リード最小人数は0以上にしてください。",
  LEAD_MIN_EXCEEDS_IDEAL: "リード最小人数は理想人数以下にしてください。",
  NEW_MAX_NEGATIVE: "初参加者の上限は0以上にしてください。",
  IDEAL_ZERO_REQUIRES_ZEROED_FIELDS: "理想人数が0のときは他の項目もすべて0にしてください。",
};

export function firstDemandValidationMessage(value: DemandValue): string | null {
  const [first] = validateDemand(value);
  return first ? DEMAND_VALIDATION_MESSAGES[first] : null;
}
