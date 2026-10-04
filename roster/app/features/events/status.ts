/**
 * Event status lifecycle (docs/roster/index.md §3 "イベントのステータス").
 *
 * Transitions are unrestricted in both directions — an owner can re-open a
 * `closed` event, or roll a `published` one back to `draft` — so there is no
 * transition table here. `canApply` decides whether `/apply/:applyToken`
 * (Stage 04) accepts registrations. Public schedule visibility belongs to
 * each roster sheet's `visibility`, not the event's recruitment status.
 */

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

/** Does `/apply/:applyToken` accept staff registrations for an event in this status? */
export function canApply(status: EventStatus): boolean {
  return status === "open";
}
