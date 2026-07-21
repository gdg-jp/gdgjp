import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLoaderData } from "react-router";
import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import Toast from "~/components/Toast";
import ChangesetReview from "~/components/ingest/ChangesetReview";
import SensitiveReviewModal from "~/components/ingest/SensitiveReviewModal";
import type { ResolvedItem } from "~/components/ingest/SensitiveReviewModal";
import { MotionSwap } from "~/components/ui/motion";
import * as schema from "~/db/schema";
import { requireUser } from "~/lib/auth-utils.server";
import type { AiDraftJson, ClarificationQuestion } from "~/lib/ingestion-pipeline.server";
import type { ExtractedUrl } from "~/lib/url-extract";

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

export async function loader({ request, context, params }: LoaderFunctionArgs) {
  const { env } = context.cloudflare;
  const user = await requireUser(request, env);
  const db = drizzle(env.DB, { schema });

  const session = await db
    .select()
    .from(schema.ingestionSessions)
    .where(eq(schema.ingestionSessions.id, params.sessionId ?? ""))
    .get();

  if (!session) throw new Response("Not found", { status: 404 });
  if (session.userId !== user.id) throw new Response("Forbidden", { status: 403 });

  // Pre-SSO this surfaced sibling pages in the user's own chapter as
  // candidate parents for the incoming draft. Wiki no longer stores
  // per-user chapter membership; until the IdP /userinfo claim is read
  // live, the page index defaults to empty (users pick the parent
  // explicitly in the UI).
  const pageIndex: Array<{
    id: string;
    titleJa: string;
    titleEn: string;
    slug: string;
    parentId: string | null;
  }> = [];

  const imageKeys = (() => {
    try {
      const parsed = JSON.parse(session.inputsJson) as { imageKeys?: string[] };
      return parsed.imageKeys ?? [];
    } catch {
      return [];
    }
  })();

  return {
    sessionId: session.id,
    status: session.status,
    errorMessage: session.errorMessage,
    phaseMessage: session.phaseMessage,
    draft: (() => {
      if (!session.aiDraftJson) return null;
      try {
        return JSON.parse(session.aiDraftJson) as AiDraftJson;
      } catch {
        console.error("Failed to parse ai_draft_json for session", params.sessionId);
        return null;
      }
    })(),
    isAdmin: user.isAdmin,
    imageKeys,
    pageIndex,
  };
}

export const meta: MetaFunction<typeof loader> = ({ data }) => {
  const status = data?.status;
  if (status === "processing") return [{ title: "Processing… — GDG Japan Wiki" }];
  if (status === "awaiting_clarification")
    return [{ title: "Clarification Needed — GDG Japan Wiki" }];
  if (status === "awaiting_url_selection") return [{ title: "Select URLs — GDG Japan Wiki" }];
  if (status === "error") return [{ title: "Ingestion Error — GDG Japan Wiki" }];
  return [{ title: "Review Draft — GDG Japan Wiki" }];
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Type helpers for AiDraftJson union
// ---------------------------------------------------------------------------

type ResultDraft = Extract<AiDraftJson, { planRationale: string }>;

function isClarification(
  draft: AiDraftJson | null,
): draft is Extract<AiDraftJson, { phase: "clarification" }> {
  return draft !== null && (draft as { phase?: string }).phase === "clarification";
}

function isUrlSelection(
  draft: AiDraftJson | null,
): draft is Extract<AiDraftJson, { phase: "url_selection" }> {
  return draft !== null && (draft as { phase?: string }).phase === "url_selection";
}

function isResultDraft(draft: AiDraftJson | null): draft is ResultDraft {
  if (!draft || typeof draft !== "object") return false;
  const data = draft as Record<string, unknown>;
  return (
    typeof data.planRationale === "string" &&
    Array.isArray(data.operations) &&
    Array.isArray(data.sensitiveItems) &&
    Array.isArray(data.warnings)
  );
}

// ---------------------------------------------------------------------------
// Processing UI with step-list progress
// ---------------------------------------------------------------------------

const PHASE_STEPS = [
  { key: "step1", codes: ["parsing", "clarifying", "fetching_urls"] },
  { key: "step2", codes: ["planning", "merging"] },
  { key: "step3", codes: ["generating"] },
  { key: "step4", codes: ["saving"] },
];

function getActiveStep(phaseMessage: string | null): number {
  if (!phaseMessage) return 0;
  const code = phaseMessage.split(":")[0];
  for (let i = 0; i < PHASE_STEPS.length; i++) {
    if (PHASE_STEPS[i].codes.includes(code)) return i;
  }
  return 0;
}

function ProcessingScreen({
  phaseMessage,
  t,
}: { phaseMessage: string | null; t: (k: string) => string }) {
  const activeStep = getActiveStep(phaseMessage);
  const stepLabels = [
    t("ingest.phase_step_1"),
    t("ingest.phase_step_2"),
    t("ingest.phase_step_3"),
    t("ingest.phase_step_4"),
  ];

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-gray-50">
      <div className="h-12 w-12 animate-spin rounded-full border-4 border-blue-200 border-t-blue-600" />
      <div className="text-center">
        <p className="text-lg font-medium text-gray-800">{t("ingest.processing_message")}</p>
      </div>
      <div className="w-72 space-y-2">
        {PHASE_STEPS.map((step, i) => {
          const label = stepLabels[i];
          const isDone = i < activeStep;
          const isActive = i === activeStep;
          const visualState = isDone ? "done" : isActive ? "active" : "pending";
          const detail =
            isActive && phaseMessage?.includes(":")
              ? ` — ${phaseMessage.split(":").slice(1).join(":")}`
              : "";
          return (
            <div key={step.key} className="flex items-center gap-3">
              <MotionSwap
                as="span"
                stateKey={visualState}
                className="inline-flex w-5 justify-center text-center text-sm"
              >
                {isDone ? (
                  "✓"
                ) : isActive ? (
                  <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-blue-600" />
                ) : (
                  "○"
                )}
              </MotionSwap>
              <MotionSwap as="span" stateKey={`${visualState}:${detail}`} className="inline-block">
                <span
                  className={
                    isDone
                      ? "text-sm text-green-600"
                      : isActive
                        ? "text-sm font-medium text-gray-900"
                        : "text-sm text-gray-400"
                  }
                >
                  {label}
                  {detail}
                </span>
              </MotionSwap>
            </div>
          );
        })}
      </div>
      <p className="text-sm text-gray-500">{t("ingest.processing_hint")}</p>
      <p className="text-xs text-gray-400">{t("ingest.processing_leave_hint")}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Clarification UI
// ---------------------------------------------------------------------------

function ClarificationScreen({
  sessionId,
  questions,
  summary,
  onSubmitted,
  t,
}: {
  sessionId: string;
  questions: ClarificationQuestion[];
  summary: string;
  onSubmitted: () => void;
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
      const res = await fetch(`/api/ingest/${sessionId}/clarify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          answers: questions.map((q) => ({
            id: q.id,
            question: q.question,
            answer: freeText[q.id] ?? "",
          })),
        }),
      });
      if (res.ok) {
        onSubmitted();
      } else {
        const text = await res.text().catch(() => "");
        setSubmitError(text || `Error ${res.status}`);
      }
    } catch {
      setSubmitError(t("ingest.error_heading"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-12">
      <h1 className="mb-2 text-2xl font-bold text-gray-900">{t("ingest.clarification_heading")}</h1>
      <p className="mb-6 text-sm text-gray-500">{t("ingest.clarification_hint")}</p>

      {summary && (
        <div className="mb-8 rounded-lg border border-blue-100 bg-blue-50 p-4 dark:border-blue-800 dark:bg-blue-950/50">
          <p className="mb-1 text-xs font-medium uppercase tracking-wide text-blue-700 dark:text-blue-300">
            {t("ingest.clarification_summary_label")}
          </p>
          <p className="text-sm text-gray-700 dark:text-gray-300">{summary}</p>
        </div>
      )}

      <div className="space-y-6">
        {questions.map((q) => (
          <div key={q.id}>
            <label htmlFor={`q-${q.id}`} className="mb-1 block text-sm font-medium text-gray-800">
              {q.question}
            </label>
            {q.context && <p className="mb-2 text-xs text-gray-500">{q.context}</p>}
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
                      ? "border-blue-500 bg-blue-600 text-white"
                      : "border-gray-300 bg-white text-gray-600 hover:border-blue-400 hover:text-blue-600"
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
                className="rounded-full border border-gray-200 bg-gray-50 px-3 py-1 text-xs text-gray-400 hover:border-gray-400 hover:text-gray-600"
              >
                {t("ingest.nothing_in_particular")}
              </button>
            </div>
            <textarea
              id={`q-${q.id}`}
              rows={3}
              value={freeText[q.id] ?? ""}
              onChange={(e) => setFreeText((prev) => ({ ...prev, [q.id]: e.target.value }))}
              className="w-full rounded-lg border border-gray-300 p-3 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
        ))}
      </div>

      {submitError && (
        <p className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
          {submitError}
        </p>
      )}

      <button
        type="button"
        disabled={submitting}
        onClick={handleSubmit}
        className="mt-8 rounded-lg bg-blue-600 px-6 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
      >
        {submitting ? "..." : t("ingest.clarification_submit")}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// URL Selection UI
// ---------------------------------------------------------------------------

function UrlSelectionScreen({
  sessionId,
  urls,
  onSubmitted,
  t,
}: {
  sessionId: string;
  urls: ExtractedUrl[];
  onSubmitted: () => void;
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
      const res = await fetch(`/api/ingest/${sessionId}/select-urls`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ selectedUrls }),
      });
      if (res.ok) {
        onSubmitted();
      } else {
        const text = await res.text().catch(() => "");
        setSubmitError(text || `Error ${res.status}`);
      }
    } catch {
      setSubmitError(t("ingest.error_heading"));
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
      <h1 className="mb-2 text-2xl font-bold text-gray-900">{t("ingest.url_selection_heading")}</h1>
      <p className="mb-6 text-sm text-gray-500">{t("ingest.url_selection_hint")}</p>

      <div className="space-y-3">
        {urls.map((u) => (
          <label
            key={u.id}
            className="flex cursor-pointer items-start gap-3 rounded-lg border border-gray-200 bg-white p-4 hover:border-blue-300"
          >
            <input
              type="checkbox"
              checked={selected.has(u.url)}
              onChange={() => toggleUrl(u.url)}
              className="mt-0.5 h-4 w-4 rounded border-gray-300 text-blue-600"
            />
            <div className="min-w-0 flex-1">
              <p className="break-all text-sm font-medium text-blue-600">{u.url}</p>
              <p className="mt-1 text-xs text-gray-400">
                {t(`ingest.url_source_${u.source}`)} — {u.context}
              </p>
            </div>
          </label>
        ))}
      </div>

      {submitError && (
        <p className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
          {submitError}
        </p>
      )}

      <div className="mt-8 flex items-center gap-3">
        <button
          type="button"
          disabled={submitting}
          onClick={handleSubmit}
          className="rounded-lg bg-blue-600 px-6 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {submitting ? "..." : t("ingest.url_selection_submit")}
        </button>
        <button
          type="button"
          disabled={submitting}
          onClick={handleSkip}
          className="rounded-lg border border-gray-300 bg-white px-6 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
        >
          {t("ingest.url_selection_skip")}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function IngestSessionPage() {
  const loaderData = useLoaderData<typeof loader>();
  const { t } = useTranslation();
  const imageKeys = loaderData.imageKeys;
  const [status, setStatus] = useState(loaderData.status);
  const [draft, setDraft] = useState(loaderData.draft);
  const [phaseMessage, setPhaseMessage] = useState(loaderData.phaseMessage);
  const [errorMessage, setErrorMessage] = useState(loaderData.errorMessage);
  const [sensitiveResolved, setSensitiveResolved] = useState(false);
  const [resolvedDraft, setResolvedDraft] = useState<ResultDraft | null>(null);
  const [showToast, setShowToast] = useState(false);

  const isPolling = status === "processing";

  // Poll status every 2s while processing
  useEffect(() => {
    if (!isPolling) return;
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/ingest/${loaderData.sessionId}/status`);
        if (!res.ok) return;
        const data = (await res.json()) as {
          status: string;
          errorMessage: string | null;
          phaseMessage: string | null;
        };
        setStatus(data.status);
        if (data.phaseMessage !== undefined) setPhaseMessage(data.phaseMessage);
        if (data.errorMessage) setErrorMessage(data.errorMessage);
        if (
          data.status === "done" ||
          data.status === "awaiting_clarification" ||
          data.status === "awaiting_url_selection"
        ) {
          sessionStorage.setItem(`ingest-done-${loaderData.sessionId}`, "1");
          window.location.reload();
        }
      } catch {
        // ignore network errors during polling
      }
    }, 2000);
    return () => clearInterval(interval);
  }, [isPolling, loaderData.sessionId]);

  // Show toast after reload when ingestion completes
  useEffect(() => {
    const key = `ingest-done-${loaderData.sessionId}`;
    if (sessionStorage.getItem(key)) {
      sessionStorage.removeItem(key);
      setShowToast(true);
    }
  }, [loaderData.sessionId]);

  // Processing state
  if (status === "processing") {
    return <ProcessingScreen phaseMessage={phaseMessage ?? null} t={t} />;
  }

  // Clarification state
  if (status === "awaiting_clarification" && isClarification(draft)) {
    return (
      <ClarificationScreen
        sessionId={loaderData.sessionId}
        questions={draft.questions}
        summary={draft.summary}
        onSubmitted={() => setStatus("processing")}
        t={t}
      />
    );
  }

  // URL selection state
  if (status === "awaiting_url_selection" && isUrlSelection(draft)) {
    return (
      <UrlSelectionScreen
        sessionId={loaderData.sessionId}
        urls={draft.urls}
        onSubmitted={() => setStatus("processing")}
        t={t}
      />
    );
  }

  // Error state
  if (status === "error") {
    return (
      <div className="mx-auto max-w-xl px-4 py-16 text-center">
        <div className="mb-4 text-4xl">⚠️</div>
        <h1 className="text-lg font-semibold text-gray-900">{t("ingest.error_heading")}</h1>
        {errorMessage && <p className="mt-2 text-sm text-gray-500">{errorMessage}</p>}
        <a
          href="/ingest"
          className="mt-6 inline-block rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-blue-700"
        >
          {t("ingest.retry")}
        </a>
      </div>
    );
  }

  // Done — show review (draft must be the result variant)
  if (!isResultDraft(draft)) {
    return (
      <div className="mx-auto max-w-xl px-4 py-16 text-center">
        <p className="text-gray-500">{t("ingest.draft_not_found")}</p>
      </div>
    );
  }

  const resultDraft = draft;

  // Apply sensitive item resolutions and proceed to changeset review
  function handleSensitiveResolved(resolutions: ResolvedItem[]) {
    const updatedDraft = applySensitiveResolutions(resultDraft, resolutions);
    setResolvedDraft(updatedDraft);
    setSensitiveResolved(true);
  }

  const currentDraft = resolvedDraft ?? resultDraft;
  const hasSensitive = resultDraft.sensitiveItems.length > 0;

  return (
    <div className="mx-auto max-w-4xl px-4 py-10">
      {showToast && (
        <Toast message={t("ingest.complete_toast")} onDismiss={() => setShowToast(false)} />
      )}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">{t("ingest.review_heading")}</h1>
        <p className="mt-1 text-sm text-gray-500">{t("ingest.review_subtitle")}</p>
      </div>

      {hasSensitive && !sensitiveResolved && (
        <SensitiveReviewModal
          items={resultDraft.sensitiveItems}
          onProceed={handleSensitiveResolved}
        />
      )}

      <ChangesetReview
        draft={currentDraft}
        sessionId={loaderData.sessionId}
        isAdmin={loaderData.isAdmin}
        imageKeys={imageKeys}
        pageIndex={loaderData.pageIndex}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Apply sensitive resolutions to draft
// ---------------------------------------------------------------------------

function walkStrings(value: unknown, from: string, to: string): unknown {
  if (typeof value === "string") return value.split(from).join(to);
  if (Array.isArray(value)) return value.map((v) => walkStrings(v, from, to));
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [
        k,
        walkStrings(v, from, to),
      ]),
    );
  }
  return value;
}

function applySensitiveResolutions(draft: ResultDraft, resolutions: ResolvedItem[]): ResultDraft {
  let result: unknown = draft;
  for (const { item, resolution } of resolutions) {
    if (resolution === "delete") {
      result = walkStrings(result, item.excerpt, "");
    } else if (resolution === "replace") {
      result = walkStrings(result, item.excerpt, "[要確認]");
    }
    // "keep" — do nothing
  }
  return result as ResultDraft;
}
