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

export type DayRange = { enabled: boolean; start: string; end: string };

const DEFAULT_DAY: DayRange = { enabled: false, start: "19:00", end: "22:00" };

// Builds 7 day ranges (Mon..Sun) by taking the min start time and max end time
// (= last slot start + lengthMin) of existing slots per day. Non-contiguous slots
// collapse into a single enclosing range — re-saving such an event widens the
// schedule, which is documented in the edit page.
export function deriveDayRanges(
  slots: { dayOfWeek: number; startTime: string }[],
  lengthMin: number,
): DayRange[] {
  const out: DayRange[] = Array.from({ length: 7 }, () => ({ ...DEFAULT_DAY }));
  for (let day = 0; day < 7; day++) {
    const times = slots
      .filter((s) => s.dayOfWeek === day)
      .map((s) => s.startTime)
      .sort();
    if (times.length === 0) continue;
    out[day] = {
      enabled: true,
      start: times[0],
      end: minutesToTime(timeToMinutes(times[times.length - 1]) + lengthMin),
    };
  }
  return out;
}
