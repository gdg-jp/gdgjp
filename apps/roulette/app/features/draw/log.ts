import { rankLabel } from "~/features/prizes/odds";

export type DrawLogEntry = {
  number: number;
  name: string;
  rank: number | null;
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
