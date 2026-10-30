import { rankLabel } from "~/features/prizes/odds";

/** One spin in the admin draw log. Never carries the device id. */
export type DrawLogEntry = {
  number: number;
  name: string;
  rank: number | null;
  /** Unix seconds. */
  createdAt: number;
};

const dateTimeFormat = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Asia/Tokyo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

/** "2026-10-30 14:32:05" in Japan time. */
export function formatDrawDateTime(unixSeconds: number) {
  return dateTimeFormat.format(new Date(unixSeconds * 1000));
}

function csvField(value: string) {
  // A leading = + - @ makes spreadsheets run the cell as a formula.
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return `"${safe.replaceAll('"', '""')}"`;
}

/**
 * The log as CSV, oldest first, for matching prizes handed out after the
 * event. Starts with a BOM so Excel reads it as UTF-8.
 */
export function drawLogCsv(entries: DrawLogEntry[]) {
  const rows = [...entries]
    .sort((a, b) => a.number - b.number)
    .map((entry) => [
      String(entry.number),
      formatDrawDateTime(entry.createdAt),
      rankLabel(entry.rank),
      entry.name,
    ]);
  return `﻿${[["No.", "日時", "等級", "景品"], ...rows]
    .map((row) => row.map(csvField).join(","))
    .join("\r\n")}\r\n`;
}
