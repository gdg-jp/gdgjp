import { useState } from "react";
import type { ExtractedUrl } from "~/lib/url-extract";
import type { ClarificationQuestion } from "../../../../shared/ingestion/domain";

export function ClarificationScreen({
  questions,
  summary,
  onSubmitted,
  t,
}: {
  questions: ClarificationQuestion[];
  summary: string;
  onSubmitted: (answers: Array<{ id: string; question: string; answer: string }>) => Promise<void>;
  t: (k: string) => string;
}) {
  const [selected, setSelected] = useState<Record<string, string[]>>(() =>
    Object.fromEntries(questions.map((q) => [q.id, []])),
  );
  const [freeText, setFreeText] = useState<Record<string, string>>(() =>
    Object.fromEntries(questions.map((q) => [q.id, ""])),
  );
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  async function handleSubmit() {
    setSubmitting(true);
    setSubmitError(null);
    try {
      await onSubmitted(
        questions.map((q) => ({
          id: q.id,
          question: q.question,
          answer: freeText[q.id] ?? "",
        })),
      );
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : t("ingest.error_heading"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-12">
      <h1 className="mb-2 text-2xl font-bold text-content-primary">
        {t("ingest.clarification_heading")}
      </h1>
      <p className="mb-6 text-sm text-content-tertiary">{t("ingest.clarification_hint")}</p>

      {summary && (
        <div className="mb-8 rounded-lg border border-feedback-info-border bg-feedback-info-surface p-4  ">
          <p className="mb-1 text-xs font-medium uppercase tracking-wide text-action-primary-hover ">
            {t("ingest.clarification_summary_label")}
          </p>
          <p className="text-sm text-content-secondary dark:text-content-disabled">{summary}</p>
        </div>
      )}

      <div className="space-y-6">
        {questions.map((q) => (
          <div key={q.id}>
            <label
              htmlFor={`q-${q.id}`}
              className="mb-1 block text-sm font-medium text-content-primary"
            >
              {q.question}
            </label>
            {q.context && <p className="mb-2 text-xs text-content-tertiary">{q.context}</p>}
            <div className="mb-2 flex flex-wrap gap-2">
              {(q.suggestions ?? []).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() =>
                    setSelected((prev) => {
                      const cur = prev[q.id] ?? [];
                      const next = cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s];
                      setFreeText((prevText) => ({ ...prevText, [q.id]: next.join(", ") }));
                      return { ...prev, [q.id]: next };
                    })
                  }
                  className={`rounded-full border px-3 py-1 text-xs ${
                    (selected[q.id] ?? []).includes(s)
                      ? "border-border-focus bg-action-primary text-action-primary-foreground"
                      : "border-border-strong bg-surface-raised text-content-secondary hover:border-border-focus hover:text-action-primary"
                  }`}
                >
                  {s}
                </button>
              ))}
              <button
                type="button"
                onClick={() => {
                  setSelected((prev) => ({ ...prev, [q.id]: [] }));
                  setFreeText((prev) => ({ ...prev, [q.id]: t("ingest.nothing_in_particular") }));
                }}
                className="rounded-full border border-border-default bg-surface-sunken px-3 py-1 text-xs text-content-disabled hover:border-border-strong hover:text-content-secondary"
              >
                {t("ingest.nothing_in_particular")}
              </button>
            </div>
            <textarea
              id={`q-${q.id}`}
              rows={3}
              value={freeText[q.id] ?? ""}
              onChange={(e) => setFreeText((prev) => ({ ...prev, [q.id]: e.target.value }))}
              className="w-full rounded-lg border border-border-strong p-3 text-sm focus:border-border-focus focus:outline-none focus:ring-1 focus:ring-border-focus"
            />
          </div>
        ))}
      </div>

      {submitError && (
        <p className="mt-4 rounded-lg border border-feedback-danger-border bg-feedback-danger-surface px-4 py-2 text-sm text-feedback-danger-foreground">
          {submitError}
        </p>
      )}

      <button
        type="button"
        disabled={submitting}
        onClick={handleSubmit}
        className="mt-8 rounded-lg bg-action-primary px-6 py-2.5 text-sm font-medium text-action-primary-foreground hover:bg-action-primary-hover disabled:opacity-50"
      >
        {submitting ? "..." : t("ingest.clarification_submit")}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// URL Selection UI
// ---------------------------------------------------------------------------

export function UrlSelectionScreen({
  urls,
  onSubmitted,
  t,
}: {
  urls: ExtractedUrl[];
  onSubmitted: (selectedUrls: string[]) => Promise<void>;
  t: (k: string) => string;
}) {
  const [selected, setSelected] = useState<Set<string>>(() => new Set(urls.map((u) => u.url)));
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  function toggleUrl(url: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(url)) next.delete(url);
      else next.add(url);
      return next;
    });
  }

  async function postSelectedUrls(selectedUrls: string[]) {
    setSubmitting(true);
    setSubmitError(null);
    try {
      await onSubmitted(selectedUrls);
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : t("ingest.error_heading"));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSubmit() {
    await postSelectedUrls([...selected]);
  }

  async function handleSkip() {
    await postSelectedUrls([]);
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-12">
      <h1 className="mb-2 text-2xl font-bold text-content-primary">
        {t("ingest.url_selection_heading")}
      </h1>
      <p className="mb-6 text-sm text-content-tertiary">{t("ingest.url_selection_hint")}</p>

      <div className="space-y-3">
        {urls.map((u) => (
          <label
            key={u.id}
            className="flex cursor-pointer items-start gap-3 rounded-lg border border-border-default bg-surface-raised p-4 hover:border-border-focus"
          >
            <input
              type="checkbox"
              checked={selected.has(u.url)}
              onChange={() => toggleUrl(u.url)}
              className="mt-0.5 h-4 w-4 rounded border-border-strong text-action-primary"
            />
            <div className="min-w-0 flex-1">
              <p className="break-all text-sm font-medium text-action-primary">{u.url}</p>
              <p className="mt-1 text-xs text-content-disabled">
                {t(`ingest.url_source_${u.source}`)} — {u.context}
              </p>
            </div>
          </label>
        ))}
      </div>

      {submitError && (
        <p className="mt-4 rounded-lg border border-feedback-danger-border bg-feedback-danger-surface px-4 py-2 text-sm text-feedback-danger-foreground">
          {submitError}
        </p>
      )}

      <div className="mt-8 flex items-center gap-3">
        <button
          type="button"
          disabled={submitting}
          onClick={handleSubmit}
          className="rounded-lg bg-action-primary px-6 py-2.5 text-sm font-medium text-action-primary-foreground hover:bg-action-primary-hover disabled:opacity-50"
        >
          {submitting ? "..." : t("ingest.url_selection_submit")}
        </button>
        <button
          type="button"
          disabled={submitting}
          onClick={handleSkip}
          className="rounded-lg border border-border-strong bg-surface-raised px-6 py-2.5 text-sm font-medium text-content-secondary hover:bg-surface-hover disabled:opacity-50"
        >
          {t("ingest.url_selection_skip")}
        </button>
      </div>
    </div>
  );
}
