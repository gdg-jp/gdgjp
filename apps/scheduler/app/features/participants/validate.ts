export function parseSlotIds(form: FormData): number[] {
  const out = new Set<number>();
  for (const v of form.getAll("slot_id")) {
    const n = typeof v === "string" ? Number.parseInt(v, 10) : Number.NaN;
    if (Number.isInteger(n) && n > 0) out.add(n);
  }
  return Array.from(out);
}
