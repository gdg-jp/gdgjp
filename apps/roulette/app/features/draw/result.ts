import type { Tier } from "~/features/prizes/prize";

export type DrawResult = {
  name: string;
  prizeId: string | null;
  rank: number | null;
  tier: Tier;
  number: number;
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

export function drawNumberLabel(number: number) {
  return `No. ${String(number).padStart(3, "0")}`;
}
