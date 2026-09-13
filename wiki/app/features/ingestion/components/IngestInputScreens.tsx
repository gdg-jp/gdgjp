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
      <h1 className="mb-2 text-2xl font-bold text-foreground">
        {t("ingest.clarification_heading")}
      </h1>
      <p className="mb-6 text-sm text-muted">{t("ingest.clarification_hint")}</p>

      {summary && (
        <div className="mb-8 rounded-lg border border-link bg-selected p-4  ">
          <p className="mb-1 text-xs font-medium uppercase tracking-wide text-link ">
            {t("ingest.clarification_summary_label")}
          </p>
          <p className="text-sm text-muted dark:text-muted/70">{summary}</p>
        </div>
      )}

      <div className="space-y-6">
        {questions.map((q) => (
          <div key={q.id}>
            <label htmlFor={`q-${q.id}`} className="mb-1 block text-sm font-medium text-foreground">
              {q.question}
            </label>
            {q.context && <p className="mb-2 text-xs text-muted">{q.context}</p>}
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
                      ? "border-border-ring bg-primary text-primary-foreground"
                      : "border-border bg-surface text-muted hover:border-border-ring hover:text-link"
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
                className="rounded-full border border-border bg-neutral px-3 py-1 text-xs text-muted/70 hover:border-border hover:text-muted"
              >
                {t("ingest.nothing_in_particular")}
              </button>
            </div>
            <textarea
              id={`q-${q.id}`}
              rows={3}
              value={freeText[q.id] ?? ""}
              onChange={(e) => setFreeText((prev) => ({ ...prev, [q.id]: e.target.value }))}
              className="w-full rounded-lg border border-border p-3 text-sm focus:border-border-ring focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
        ))}
      </div>

      {submitError && (
        <p className="mt-4 rounded-lg border border-danger bg-[var(--gdg-danger-surface)] px-4 py-2 text-sm text-danger">
          {submitError}
        </p>
      )}

      <button
        type="button"
        disabled={submitting}
        onClick={handleSubmit}
        className="mt-8 rounded-lg bg-primary px-6 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
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
      <h1 className="mb-2 text-2xl font-bold text-foreground">
        {t("ingest.url_selection_heading")}
      </h1>
      <p className="mb-6 text-sm text-muted">{t("ingest.url_selection_hint")}</p>

      <div className="space-y-3">
        {urls.map((u) => (
          <label
            key={u.id}
            className="flex cursor-pointer items-start gap-3 rounded-lg border border-border bg-surface p-4 hover:border-border-ring"
          >
            <input
              type="checkbox"
              checked={selected.has(u.url)}
              onChange={() => toggleUrl(u.url)}
              className="mt-0.5 h-4 w-4 rounded border-border text-link"
            />
            <div className="min-w-0 flex-1">
              <p className="break-all text-sm font-medium text-link">{u.url}</p>
              <p className="mt-1 text-xs text-muted/70">
                {t(`ingest.url_source_${u.source}`)} — {u.context}
              </p>
            </div>
          </label>
        ))}
      </div>

      {submitError && (
        <p className="mt-4 rounded-lg border border-danger bg-[var(--gdg-danger-surface)] px-4 py-2 text-sm text-danger">
          {submitError}
        </p>
      )}

      <div className="mt-8 flex items-center gap-3">
        <button
          type="button"
          disabled={submitting}
          onClick={handleSubmit}
          className="rounded-lg bg-primary px-6 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {submitting ? "..." : t("ingest.url_selection_submit")}
        </button>
        <button
          type="button"
          disabled={submitting}
          onClick={handleSkip}
          className="rounded-lg border border-border bg-surface px-6 py-2.5 text-sm font-medium text-muted hover:bg-neutral disabled:opacity-50"
        >
          {t("ingest.url_selection_skip")}
        </button>
      </div>
    </div>
  );
}
