import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import {
  ACTIVE_SOURCE_STATUSES,
  type SourceListView,
  collectSourceKinds,
  countSourceViews,
  parseSourceFilters,
  serializeCsvParam,
} from "./filter-sources";

const ALL_VALUE = "__all__";

type SourcesToolbarProps = {
  sources: Array<{ kind: string; status: string }>;
};

export default function SourcesToolbar({ sources }: SourcesToolbarProps) {
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  const filters = useMemo(() => parseSourceFilters(searchParams), [searchParams]);
  const counts = useMemo(() => countSourceViews(sources), [sources]);
  const kinds = useMemo(() => collectSourceKinds(sources), [sources]);

  function patchParams(patch: Record<string, string | null>) {
    const next = new URLSearchParams(searchParams);
    for (const [key, value] of Object.entries(patch)) {
      if (value === null || value === "") next.delete(key);
      else next.set(key, value);
    }
    setSearchParams(next, { replace: true, preventScrollReset: true });
  }

  function setView(view: SourceListView) {
    patchParams({
      view: view === "active" ? null : view,
      status: view === "archived" ? null : serializeCsvParam(filters.status),
    });
  }

  return (
    <div className="mb-4 space-y-3">
      <div className="inline-flex rounded-md border border-border-default bg-surface-raised p-0.5">
        <button
          type="button"
          onClick={() => setView("active")}
          className={`rounded px-3 py-1.5 text-sm font-medium ${
            filters.view === "active"
              ? "bg-surface-sunken text-content-primary"
              : "text-content-secondary hover:text-content-primary"
          }`}
        >
          {t("sources.view_active")}
          <span className="ml-1.5 text-xs text-content-tertiary">{counts.active}</span>
        </button>
        <button
          type="button"
          onClick={() => setView("archived")}
          className={`rounded px-3 py-1.5 text-sm font-medium ${
            filters.view === "archived"
              ? "bg-surface-sunken text-content-primary"
              : "text-content-secondary hover:text-content-primary"
          }`}
        >
          {t("sources.view_archived")}
          <span className="ml-1.5 text-xs text-content-tertiary">{counts.archived}</span>
        </button>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        <input
          type="search"
          value={filters.q}
          onChange={(event) => patchParams({ q: event.target.value || null })}
          placeholder={t("sources.search_placeholder")}
          aria-label={t("sources.search_placeholder")}
          className="w-full rounded-md border border-border-strong bg-surface-raised px-3 py-2 text-sm text-content-primary placeholder:text-content-tertiary sm:max-w-xs"
        />

        <Select
          value={filters.kind[0] ?? ALL_VALUE}
          onValueChange={(value) =>
            patchParams({ kind: value === ALL_VALUE ? null : serializeCsvParam([value]) })
          }
        >
          <SelectTrigger
            className="w-full bg-surface-raised sm:w-48"
            aria-label={t("sources.filter_kind")}
          >
            <SelectValue placeholder={t("sources.filter_kind")} />
          </SelectTrigger>
          <SelectContent position="popper">
            <SelectItem value={ALL_VALUE}>{t("sources.filter_all")}</SelectItem>
            {kinds.map((kind) => (
              <SelectItem key={kind} value={kind}>
                {t(`sources.kind.${kind}`, kind)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {filters.view === "active" ? (
          <Select
            value={filters.status[0] ?? ALL_VALUE}
            onValueChange={(value) =>
              patchParams({ status: value === ALL_VALUE ? null : serializeCsvParam([value]) })
            }
          >
            <SelectTrigger
              className="w-full bg-surface-raised sm:w-40"
              aria-label={t("sources.filter_status")}
            >
              <SelectValue placeholder={t("sources.filter_status")} />
            </SelectTrigger>
            <SelectContent position="popper">
              <SelectItem value={ALL_VALUE}>{t("sources.filter_all")}</SelectItem>
              {ACTIVE_SOURCE_STATUSES.map((status) => (
                <SelectItem key={status} value={status}>
                  {t(`sources.status.${status}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}
      </div>
    </div>
  );
}
