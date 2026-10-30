import type { Tier } from "~/features/prizes/prize";

/** One spin as the visitor sees it. No stock or odds ever leave the server. */
export type DrawResult = {
  name: string;
  /** Points the wheel at a matching slice. Null when the prize was deleted afterwards. */
  prizeId: string | null;
  rank: number | null;
  tier: Tier;
  number: number;
  /** "10/30 14:32" in Japan time. */
  time: string;
};

const timeFormat = new Intl.DateTimeFormat("ja-JP", {
  timeZone: "Asia/Tokyo",
  month: "numeric",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

export function formatDrawTime(unixSeconds: number) {
  const parts = Object.fromEntries(
    timeFormat.formatToParts(new Date(unixSeconds * 1000)).map((part) => [part.type, part.value]),
  );
  return `${parts.month}/${parts.day} ${parts.hour}:${parts.minute}`;
}

/** "No. 012": the number visitors show at the prize desk and the admin log lists. */
export function drawNumberLabel(number: number) {
  return `No. ${String(number).padStart(3, "0")}`;
}
