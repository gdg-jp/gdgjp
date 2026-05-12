const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

export type SlotInput = { dayOfWeek: number; startTime: string };

export type EventForm = {
  title: string;
  description: string | null;
  slots: SlotInput[];
};

export type ParseResult<T> = { ok: true; value: T } | { ok: false; errors: string[] };

export function parseTime(value: unknown): string | null {
  if (typeof value !== "string") return null;
  return TIME_RE.test(value) ? value : null;
}

export function parseDay(value: unknown): number | null {
  const n = typeof value === "string" ? Number.parseInt(value, 10) : value;
  if (typeof n !== "number" || !Number.isInteger(n) || n < 0 || n > 6) return null;
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

  const days = form.getAll("slot_day");
  const times = form.getAll("slot_time");
  if (days.length !== times.length) {
    errors.push("Slot day/time mismatch");
  }
  const seen = new Set<string>();
  const slots: SlotInput[] = [];
  for (let i = 0; i < days.length; i++) {
    const day = parseDay(days[i]);
    const time = parseTime(times[i]);
    if (day === null || time === null) continue;
    const key = `${day}-${time}`;
    if (seen.has(key)) continue;
    seen.add(key);
    slots.push({ dayOfWeek: day, startTime: time });
  }
  if (slots.length === 0) errors.push("Add at least one candidate slot");

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, value: { title, description, slots } };
}

export function parseSlotIds(form: FormData): number[] {
  const out = new Set<number>();
  for (const v of form.getAll("slot_id")) {
    const n = typeof v === "string" ? Number.parseInt(v, 10) : Number.NaN;
    if (Number.isInteger(n) && n > 0) out.add(n);
  }
  return Array.from(out);
}
