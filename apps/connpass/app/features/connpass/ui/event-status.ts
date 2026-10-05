export type EventStatus = "draft" | "published" | "canceled";

export function mapListStatus(label: string): EventStatus {
  if (label.includes("中止")) return "canceled";
  // Only observed on the sub-event table (event-edit_サブイベント追加後.htm) —
  // the public group event list appears to never show drafts.
  if (label.includes("下書き")) return "draft";
  return "published";
}
