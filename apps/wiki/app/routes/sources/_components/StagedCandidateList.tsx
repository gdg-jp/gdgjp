import { useTranslation } from "react-i18next";
import type { StagedSource } from "~/features/sources/staged-candidates";

/** Editable list of not-yet-imported staged sources for the `/sources` panel. */
import { Icons } from "@gdgjp/design-system";
export function StagedCandidateList({
  candidates,
  candidateErrors,
  onRemove,
  onUpdateUrl,
}: {
  candidates: StagedSource[];
  candidateErrors: Record<string, string>;
  onRemove: (id: string) => void;
  onUpdateUrl: (id: string, url: string) => void;
}) {
  const { t } = useTranslation();
  if (candidates.length === 0) return null;
  return (
    <ul className="mt-4 divide-y divide-border-border rounded-md border border-border">
      {candidates.map((candidate) => (
        <li key={candidate.id} className="flex items-start gap-3 px-3 py-2">
          {candidate.kind === "google-drive" ? (
            <Icons name="FileText" className="mt-0.5 size-4 shrink-0" />
          ) : candidate.kind === "url" ? (
            <Icons name="Link2" className="mt-0.5 size-4 shrink-0" />
          ) : candidate.kind === "discord-channel" ? (
            <Icons name="Hash" className="mt-0.5 size-4 shrink-0" />
          ) : (
            <Icons name="MessageSquare" className="mt-0.5 size-4 shrink-0" />
          )}
          <div className="min-w-0 flex-1">
            {candidate.kind === "url" ? (
              <input
                type="url"
                value={candidate.url}
                onChange={(event) => onUpdateUrl(candidate.id, event.target.value)}
                placeholder={t("sources.url_placeholder")}
                className="w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm text-foreground placeholder:text-muted focus:border-border focus:outline-none"
              />
            ) : (
              <>
                <p className="truncate text-sm font-medium text-foreground">{candidate.title}</p>
                <a
                  href={candidate.url}
                  target="_blank"
                  rel="noreferrer"
                  className="block truncate text-xs text-link hover:underline"
                >
                  {candidate.url}
                </a>
              </>
            )}
            {candidateErrors[candidate.id] ? (
              <p className="mt-1 text-xs text-danger">
                {t(`sources.error_${candidateErrors[candidate.id]}`, {
                  defaultValue: t("sources.error_generic"),
                })}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={() => onRemove(candidate.id)}
            className="rounded p-1 text-muted hover:bg-neutral"
            aria-label={t("sources.remove_candidate", {
              title: candidate.title || candidate.url || t("sources.add_url"),
            })}
          >
            <Icons name="Trash2" className="size-4" />
          </button>
        </li>
      ))}
    </ul>
  );
}
