/** Where applications stand against the brief's goal curve (the weekly meeting's first slide). */
export type GoalPoint = { date: string; applications: number };

/** Linear interpolation of the goal curve at a date (before the first point: 0 → first). */
export function goalAt(curve: GoalPoint[], date: string): number | null {
  const points = [...curve].sort((a, b) => a.date.localeCompare(b.date));
  if (!points.length) return null;
  const t = Date.parse(date);
  const first = points[0] as GoalPoint;
  if (t <= Date.parse(first.date)) return first.applications;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1] as GoalPoint;
    const b = points[i] as GoalPoint;
    const ta = Date.parse(a.date);
    const tb = Date.parse(b.date);
    if (t <= tb)
      return Math.round(
        a.applications + ((b.applications - a.applications) * (t - ta)) / Math.max(1, tb - ta),
      );
  }
  return (points.at(-1) as GoalPoint).applications;
}

export function goalStatus(input: {
  curve: GoalPoint[];
  goal: number;
  today: string;
  eventDate: string;
  applications: number;
}) {
  const curve = input.curve.length
    ? input.curve
    : [{ date: input.eventDate, applications: input.goal }];
  const expected = goalAt(curve, input.today) ?? 0;
  const daysLeft = Math.max(
    0,
    Math.ceil((Date.parse(input.eventDate) - Date.parse(input.today)) / 86_400_000),
  );
  const remaining = Math.max(0, input.goal - input.applications);
  return {
    expected,
    diff: input.applications - expected,
    daysLeft,
    perDayNeeded: daysLeft ? Math.ceil(remaining / daysLeft) : remaining,
  };
}
