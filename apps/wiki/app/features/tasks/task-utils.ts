interface TaskWithDueDate {
  dueDate: string | null;
}

export function getDateRange(tasks: TaskWithDueDate[]): string[] {
  const tasksWithDates = tasks.filter((t) => t.dueDate);
  if (tasksWithDates.length === 0) return [];

  const dates = tasksWithDates.map((t) => t.dueDate as string).sort();

  const parseUTC = (s: string) => {
    const [y, m, d] = s.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d));
  };
  const toYMD = (dt: Date) =>
    `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;

  const start = parseUTC(dates[0]);
  const end = parseUTC(dates[dates.length - 1]);

  // Extend range by 3 days on each side
  start.setUTCDate(start.getUTCDate() - 3);
  end.setUTCDate(end.getUTCDate() + 3);

  const result: string[] = [];
  const current = new Date(start);
  while (current <= end) {
    result.push(toYMD(current));
    current.setUTCDate(current.getUTCDate() + 1);
  }
  return result;
}

export function formatDate(dateStr: string): string {
  const [, m, d] = dateStr.split("-").map(Number);
  return `${m}/${d}`;
}

/** Format YYYY-MM-DD → YY/MM/DD for compact display */
export function formatDueDate(dateStr: string): string {
  const [y, m, d] = dateStr.split("-");
  return `${y.slice(2)}/${m}/${d}`;
}

export function isWeekend(dateStr: string): boolean {
  const [y, m, d] = dateStr.split("-").map(Number);
  const day = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return day === 0 || day === 6;
}
