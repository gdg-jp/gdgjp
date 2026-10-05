import { Link, PageHeader } from "@gdgjp/design-system";
import { Link as RouterLink } from "react-router";

export function SheetHeader({
  eventId,
  eventName,
  sheet,
  active,
}: {
  eventId: string;
  eventName: string;
  sheet: { id: string; name: string; date: string; startTime?: string; endTime?: string };
  active: "roster" | "design";
}) {
  const base = `/e/${encodeURIComponent(eventId)}/s/${encodeURIComponent(sheet.id)}`;
  return (
    <div className="space-y-4 sheet-page-header">
      <span className="brand-eyebrow">
        SHIFT BOARD / {active === "roster" ? "ASSIGN" : "DESIGN"}
      </span>
      <PageHeader
        title={sheet.name}
        description={`${eventName} · ${sheet.date}${sheet.startTime && sheet.endTime ? ` · ${sheet.startTime}–${sheet.endTime}` : ""}`}
        back={
          <Link asChild>
            <RouterLink to={`/e/${encodeURIComponent(eventId)}`}>シフト表一覧に戻る</RouterLink>
          </Link>
        }
      />
      <nav aria-label={`${sheet.name}の操作`} className="flex gap-2 border-b pb-2">
        <RouterLink
          to={`${base}/roster`}
          aria-current={active === "roster" ? "page" : undefined}
          className={`sheet-tab ${active === "roster" ? "sheet-tab-active" : ""}`}
        >
          割当
        </RouterLink>
        <RouterLink
          to={`${base}/design`}
          aria-current={active === "design" ? "page" : undefined}
          className={`sheet-tab ${active === "design" ? "sheet-tab-active" : ""}`}
        >
          設計
        </RouterLink>
      </nav>
    </div>
  );
}
