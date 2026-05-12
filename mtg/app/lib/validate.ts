import { MEETING_LENGTH_OPTIONS, generateSlotTimes, isValidTime, timeToMinutes } from "./slots";

export type SlotInput = { dayOfWeek: number; startTime: string };

export type EventForm = {
  title: string;
  description: string | null;
  slotMinutes: number;
  slots: SlotInput[];
};

export type ParseResult<T> = { ok: true; value: T } | { ok: false; errors: string[] };

const VALID_MINUTES = new Set(MEETING_LENGTH_OPTIONS.map((o) => o.value));

export function parseTime(value: unknown): string | null {
  if (typeof value !== "string") return null;
  return isValidTime(value) ? value : null;
}

export function parseMinutes(value: unknown): number | null {
  const n = typeof value === "string" ? Number.parseInt(value, 10) : value;
  if (typeof n !== "number" || !Number.isInteger(n) || !VALID_MINUTES.has(n)) return null;
  return n;
}

export function parseEventForm(form: FormData): ParseResult<EventForm> {
  const errors: string[] = [];

  const title = (form.get("title") ?? "").toString().trim();
  if (!title) errors.push("Title is required");
  if (title.length > 200) errors.push("Title is too long (max 200 chars)");

  const descRaw = (form.get("description") ?? "").toString().trim();
  const description = descRaw || null;
  if (description && description.length > 2000) {
    errors.push("Description is too long (max 2000 chars)");
  }

  const slotMinutes = parseMinutes(form.get("slot_minutes"));
  if (slotMinutes === null) errors.push("Pick a valid meeting length");

  const slots: SlotInput[] = [];
  if (slotMinutes !== null) {
    for (let day = 0; day < 7; day++) {
      const start = parseTime(form.get(`day_${day}_start`));
      const end = parseTime(form.get(`day_${day}_end`));
      if (!start && !end) continue;
      if (!start || !end) {
        errors.push(`Day ${day}: both start and end are required`);
        continue;
      }
      if (timeToMinutes(end) <= timeToMinutes(start)) {
        errors.push(`Day ${day}: end must be after start`);
        continue;
      }
      if (timeToMinutes(end) - timeToMinutes(start) < slotMinutes) {
        errors.push(`Day ${day}: range is shorter than the meeting length`);
        continue;
      }
      for (const t of generateSlotTimes(start, end, slotMinutes)) {
        slots.push({ dayOfWeek: day, startTime: t });
      }
    }
  }
  if (slots.length === 0 && errors.length === 0) {
    errors.push("Enable at least one day with a time range");
  }

  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: { title, description, slotMinutes: slotMinutes as number, slots },
  };
}

export function parseSlotIds(form: FormData): number[] {
  const out = new Set<number>();
  for (const v of form.getAll("slot_id")) {
    const n = typeof v === "string" ? Number.parseInt(v, 10) : Number.NaN;
    if (Number.isInteger(n) && n > 0) out.add(n);
  }
  return Array.from(out);
}
