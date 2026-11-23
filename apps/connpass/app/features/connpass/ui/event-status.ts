export type EventStatus = "draft" | "published" | "canceled";

export function mapListStatus(label: string): EventStatus {
  if (label.includes("中止")) return "canceled";
  if (label.includes("下書き")) return "draft";
  return "published";
}
