import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "~/components/ui/alert-dialog";
import type { SensitiveItem } from "../../../shared/ingestion/domain";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SensitiveResolution = "keep" | "delete" | "replace";

export interface ResolvedItem {
  item: SensitiveItem;
  resolution: SensitiveResolution;
}

interface SensitiveReviewModalProps {
  items: SensitiveItem[];
  onProceed: (resolutions: ResolvedItem[]) => void;
}

// ---------------------------------------------------------------------------
// Label helpers
// ---------------------------------------------------------------------------

const TYPE_COLORS: Record<string, string> = {
  email: "bg-feedback-info-surface text-action-primary",
  phone: "bg-feedback-success-surface text-feedback-success-foreground",
  "sns-handle": "bg-feedback-info-surface text-action-primary",
  financial: "bg-feedback-warning-surface text-feedback-warning-foreground",
  "personal-opinion": "bg-feedback-warning-surface text-feedback-warning-foreground",
  credential: "bg-feedback-danger-surface text-feedback-danger-foreground",
  other: "bg-surface-sunken text-content-secondary",
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function SensitiveReviewModal({ items, onProceed }: SensitiveReviewModalProps) {
  const { t } = useTranslation();
  const [resolutions, setResolutions] = useState<Record<string, SensitiveResolution>>(
    Object.fromEntries(items.map((item) => [item.id, "replace" as SensitiveResolution])),
  );

  useEffect(() => {
    setResolutions(
      Object.fromEntries(items.map((item) => [item.id, "replace" as SensitiveResolution])),
    );
  }, [items]);

  const allResolved = items.every((item) => resolutions[item.id] !== undefined);

  function setResolution(id: string, resolution: SensitiveResolution) {
    setResolutions((prev) => ({ ...prev, [id]: resolution }));
  }

  function handleProceed() {
    const resolved: ResolvedItem[] = items.map((item) => ({
      item,
      resolution: resolutions[item.id] ?? "keep",
    }));
    onProceed(resolved);
  }

  return (
    <AlertDialog open>
      <AlertDialogContent className="max-h-[calc(100dvh-2rem)] max-w-2xl gap-0 overflow-hidden rounded-2xl bg-card p-0 text-card-foreground shadow-2xl shadow-content-primary/20">
        {/* Header */}
        <AlertDialogHeader className="flex grid-cols-none grid-rows-none flex-row items-start gap-3 border-b border-border px-6 py-5 text-left">
          <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-feedback-warning-surface">
            <svg
              className="h-5 w-5 text-feedback-warning-foreground"
              viewBox="0 0 20 20"
              fill="currentColor"
              aria-label={t("ingest.sensitive.title")}
              role="img"
            >
              <title>{t("ingest.sensitive.title")}</title>
              <path
                fillRule="evenodd"
                d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
                clipRule="evenodd"
              />
            </svg>
          </div>
          <div>
            <AlertDialogTitle className="text-base font-semibold text-foreground">
              {t("ingest.sensitive.title")}
            </AlertDialogTitle>
            <AlertDialogDescription className="mt-0.5 text-sm text-muted-foreground">
              {t("ingest.sensitive.subtitle")}
            </AlertDialogDescription>
          </div>
        </AlertDialogHeader>

        {/* Items */}
        <div className="max-h-96 overflow-y-auto px-6 py-4">
          <div className="space-y-5">
            {items.map((item, idx) => (
              <div key={item.id} className="rounded-lg border border-subtle p-4">
                <div className="mb-2 flex items-center gap-2">
                  <span className="text-sm font-medium text-content-tertiary">{idx + 1}.</span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${TYPE_COLORS[item.type] ?? "bg-surface-sunken text-content-secondary"}`}
                  >
                    {t(`ingest.sensitive.type.${item.type}`, { defaultValue: item.type })}
                  </span>
                </div>

                <div className="mb-1 font-mono text-sm text-content-primary bg-surface-canvas rounded px-2 py-1">
                  {item.excerpt}
                </div>
                <div className="mb-3 text-xs text-content-tertiary">
                  {t("ingest.sensitive.location", { location: item.location })}
                </div>

                <div className="flex flex-wrap gap-3">
                  {(["keep", "delete", "replace"] as SensitiveResolution[]).map((res) => (
                    <label key={res} className="flex cursor-pointer items-center gap-1.5">
                      <input
                        type="radio"
                        name={`resolution-${item.id}`}
                        value={res}
                        checked={resolutions[item.id] === res}
                        onChange={() => setResolution(item.id, res)}
                        className="h-3.5 w-3.5 text-action-primary"
                      />
                      <span className="text-sm text-content-secondary">
                        {res === "keep" && t("ingest.sensitive.resolution_keep")}
                        {res === "delete" && t("ingest.sensitive.resolution_delete")}
                        {res === "replace" && t("ingest.sensitive.resolution_replace")}
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Footer */}
        <AlertDialogFooter className="border-t border-border px-6 py-4">
          <AlertDialogAction onClick={handleProceed} disabled={!allResolved} size="lg">
            {t("ingest.sensitive.proceed")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
