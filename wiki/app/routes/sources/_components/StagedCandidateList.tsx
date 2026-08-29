import { FileText, Hash, Link2, MessageSquare, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { StagedSource } from "~/features/sources/staged-candidates";

/** Editable list of not-yet-imported staged sources for the `/sources` panel. */
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
    <ul className="mt-4 divide-y divide-border-subtle rounded-md border border-border-default">
      {candidates.map((candidate) => (
        <li key={candidate.id} className="flex items-start gap-3 px-3 py-2">
          {candidate.kind === "google-drive" ? (
            <FileText className="mt-0.5 size-4 shrink-0" />
          ) : candidate.kind === "url" ? (
            <Link2 className="mt-0.5 size-4 shrink-0" />
          ) : candidate.kind === "discord-channel" ? (
            <Hash className="mt-0.5 size-4 shrink-0" />
          ) : (
            <MessageSquare className="mt-0.5 size-4 shrink-0" />
          )}
          <div className="min-w-0 flex-1">
            {candidate.kind === "url" ? (
              <input
                type="url"
                value={candidate.url}
                onChange={(event) => onUpdateUrl(candidate.id, event.target.value)}
                placeholder={t("sources.url_placeholder")}
                className="w-full rounded-md border border-border-default bg-surface-raised px-2 py-1.5 text-sm text-content-primary placeholder:text-content-tertiary focus:border-border-strong focus:outline-none"
              />
            ) : (
              <>
                <p className="truncate text-sm font-medium text-content-primary">
                  {candidate.title}
                </p>
                <a
                  href={candidate.url}
                  target="_blank"
                  rel="noreferrer"
                  className="block truncate text-xs text-action-primary hover:underline"
                >
                  {candidate.url}
                </a>
              </>
            )}
            {candidateErrors[candidate.id] ? (
              <p className="mt-1 text-xs text-feedback-danger-foreground">
                {t(`sources.error_${candidateErrors[candidate.id]}`, {
                  defaultValue: t("sources.error_generic"),
                })}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={() => onRemove(candidate.id)}
            className="rounded p-1 text-content-tertiary hover:bg-surface-hover"
            aria-label={t("sources.remove_candidate", {
              title: candidate.title || candidate.url || t("sources.add_url"),
            })}
          >
            <Trash2 className="size-4" />
          </button>
        </li>
      ))}
    </ul>
  );
}
