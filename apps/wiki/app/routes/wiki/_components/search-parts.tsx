import { useTranslation } from "react-i18next";
import { useFetcher } from "react-router";
import type { Breadcrumb } from "~/features/knowledge/wiki-search.server";

export function timeAgo(
  date: Date,
  t: (key: string, opts?: Record<string, unknown>) => string,
): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return t("time.just_now");
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return t("time.minutes_ago", { count: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t("time.hours_ago", { count: hours });
  const days = Math.floor(hours / 24);
  return t("time.days_ago", { count: days });
}

/** Where a result lives: its space (outside a space) and its parent pages (root first). */
export function ResultLocation({
  ancestors,
  spaceName,
  isJa,
}: {
  ancestors: Breadcrumb[];
  spaceName: string;
  isJa: boolean;
}) {
  const crumbs = [
    ...(spaceName ? [spaceName] : []),
    ...ancestors.map((crumb) =>
      isJa ? crumb.titleJa || crumb.titleEn : crumb.titleEn || crumb.titleJa,
    ),
  ].filter(Boolean);
  if (crumbs.length === 0) return null;
  return (
    <p className="mt-0.5 truncate text-xs text-muted/70" data-testid="search-result-location">
      {crumbs.join(" › ")}
    </p>
  );
}

/** The empty state's one-click way out when the reader's own setting hid the matches. */
export function IncludeAgentPagesButton() {
  const { t } = useTranslation();
  const fetcher = useFetcher();
  return (
    <fetcher.Form method="post" action="/api/user/preferences" className="mt-3">
      <input type="hidden" name="hideAgentPages" value="false" />
      <button
        type="submit"
        disabled={fetcher.state !== "idle"}
        className="rounded-md border border-border bg-surface px-3 py-1.5 text-sm font-medium text-foreground transition-colors hover:bg-neutral disabled:opacity-60"
      >
        {t("search.include_agent_pages")}
      </button>
    </fetcher.Form>
  );
}
