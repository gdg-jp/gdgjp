const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function isValidTime(value: string): boolean {
  return TIME_RE.test(value);
}

export function toMin(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

export function toHHMM(min: number): string {
  const h = Math.floor(min / 60);
  const mm = min % 60;
  return `${String(h).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

export type PhaseWindow = { id: string; from: string; to: string };
export type BuiltSlot = { idx: number; start: string; end: string; phaseId: string | null };

function phaseIdAt(startMin: number, phases: readonly PhaseWindow[]): string | null {
  for (const phase of phases) {
    if (toMin(phase.from) <= startMin && startMin < toMin(phase.to)) return phase.id;
  }
  return null;
}

export function buildSlots(
  input: { start: string; end: string; stepMin: number },
  phases: readonly PhaseWindow[] = [],
): BuiltSlot[] {
  const startMin = toMin(input.start);
  const endMin = toMin(input.end);
  const out: BuiltSlot[] = [];
  let idx = 0;
  for (let t = startMin; t + input.stepMin <= endMin; t += input.stepMin) {
    out.push({
      idx: idx++,
      start: toHHMM(t),
      end: toHHMM(t + input.stepMin),
      phaseId: phaseIdAt(t, phases),
    });
  }
  return out;
}
