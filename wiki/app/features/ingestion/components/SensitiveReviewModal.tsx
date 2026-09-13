import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
  Button,
  Inline,
} from "@gdgjp/ui";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { SensitiveItem } from "../../../../shared/ingestion/domain";

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
  email: "bg-selected text-link",
  phone: "bg-[var(--gdg-success-surface)] text-success",
  "sns-handle": "bg-selected text-link",
  financial: "bg-[var(--gdg-warning-surface)] text-warning",
  "personal-opinion": "bg-[var(--gdg-warning-surface)] text-warning",
  credential: "bg-[var(--gdg-danger-surface)] text-danger",
  other: "bg-neutral text-muted",
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
      <AlertDialogContent // gdg-ui-allow: literal-color — app-specific-layout-or-token
        className="max-h-[calc(100dvh-2rem)] max-w-2xl gap-0 overflow-hidden rounded-2xl bg-surface p-0 text-foreground shadow-2xl shadow-content-primary/20"
      >
        {/* Header */}
        <div className="flex items-start gap-3 border-b border-border px-6 py-5 text-left">
          <div // gdg-ui-allow: literal-color — app-specific-layout-or-token
            className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-[var(--gdg-warning-surface)]"
          >
            <svg
              className="h-5 w-5 text-warning"
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
            <AlertDialogDescription className="mt-0.5 text-sm text-muted">
              {t("ingest.sensitive.subtitle")}
            </AlertDialogDescription>
          </div>
        </div>

        {/* Items */}
        <div className="max-h-96 overflow-y-auto px-6 py-4">
          <div className="space-y-5">
            {items.map((item, idx) => (
              <div key={item.id} className="rounded-lg border border-border p-4">
                <div className="mb-2 flex items-center gap-2">
                  <span className="text-sm font-medium text-muted">{idx + 1}.</span>
                  <span
                    // gdg-ui-allow: literal-color — app-specific-layout-or-token
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${TYPE_COLORS[item.type] ?? "bg-neutral text-muted"}`}
                  >
                    {t(`ingest.sensitive.type.${item.type}`, { defaultValue: item.type })}
                  </span>
                </div>

                <div className="mb-1 font-mono text-sm text-foreground bg-background rounded px-2 py-1">
                  {item.excerpt}
                </div>
                <div className="mb-3 text-xs text-muted">
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
                        className="h-3.5 w-3.5 text-link"
                      />
                      <span className="text-sm text-muted">
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
        <Inline className="border-t border-border px-6 py-4">
          <Button asChild size="lg">
            <AlertDialogAction onClick={handleProceed} disabled={!allResolved}>
              {t("ingest.sensitive.proceed")}
            </AlertDialogAction>
          </Button>
        </Inline>
      </AlertDialogContent>
    </AlertDialog>
  );
}
