export const STATUSES = ["draft", "open", "closed", "published", "ended"] as const;

export type EventStatus = (typeof STATUSES)[number];

export const STATUS_LABELS: Record<EventStatus, string> = {
  draft: "下書き",
  open: "募集中",
  closed: "締切",
  published: "公開",
  ended: "終了",
};

export function isEventStatus(value: string): value is EventStatus {
  return (STATUSES as readonly string[]).includes(value);
}

export function canApply(status: EventStatus): boolean {
  return status === "open";
}
