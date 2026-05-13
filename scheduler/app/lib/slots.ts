export const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export const MEETING_LENGTH_OPTIONS: { value: number; label: string }[] = [
  { value: 15, label: "15 min" },
  { value: 30, label: "30 min" },
  { value: 45, label: "45 min" },
  { value: 60, label: "1 hour" },
  { value: 90, label: "1.5 hours" },
  { value: 120, label: "2 hours" },
];

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function isValidTime(t: string): boolean {
  return TIME_RE.test(t);
}

export function timeToMinutes(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

export function minutesToTime(m: number): string {
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return `${String(h).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

// Yields every meeting start that fully fits within [start, end).
export function generateSlotTimes(start: string, end: string, lengthMin: number): string[] {
  const s = timeToMinutes(start);
  const e = timeToMinutes(end);
  const out: string[] = [];
  for (let t = s; t + lengthMin <= e; t += lengthMin) {
    out.push(minutesToTime(t));
  }
  return out;
}

export type TimeRange = { start: string; end: string };
export type DayRanges = { ranges: TimeRange[] };

// 00:00..23:45 in 15-minute steps. 15 min matches the smallest meeting length,
// so every option is a valid start/end for any supported MEETING_LENGTH_OPTIONS.
export const TIME_OPTIONS: string[] = (() => {
  const out: string[] = [];
  for (let m = 0; m < 24 * 60; m += 15) out.push(minutesToTime(m));
  return out;
})();

// Groups each day's slots into contiguous ranges. Slots are contiguous when the
// gap between consecutive starts is exactly lengthMin (no missing slot in
// between). A range's end is the last slot's start + lengthMin.
export function deriveDayRanges(
  slots: { dayOfWeek: number; startTime: string }[],
  lengthMin: number,
): DayRanges[] {
  const out: DayRanges[] = Array.from({ length: 7 }, () => ({ ranges: [] }));
  for (let day = 0; day < 7; day++) {
    const times = slots
      .filter((s) => s.dayOfWeek === day)
      .map((s) => s.startTime)
      .sort();
    if (times.length === 0) continue;
    let rangeStart = times[0];
    let prev = timeToMinutes(times[0]);
    for (let i = 1; i < times.length; i++) {
      const cur = timeToMinutes(times[i]);
      if (cur - prev > lengthMin) {
        out[day].ranges.push({ start: rangeStart, end: minutesToTime(prev + lengthMin) });
        rangeStart = times[i];
      }
      prev = cur;
    }
    out[day].ranges.push({ start: rangeStart, end: minutesToTime(prev + lengthMin) });
  }
  return out;
}
