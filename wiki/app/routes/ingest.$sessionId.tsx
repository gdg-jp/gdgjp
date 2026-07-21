import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLoaderData, useRevalidator } from "react-router";
import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import Toast from "~/components/Toast";
import ChangesetReview from "~/components/ingest/ChangesetReview";
import SensitiveReviewModal from "~/components/ingest/SensitiveReviewModal";
import type { ResolvedItem } from "~/components/ingest/SensitiveReviewModal";
import { MotionSwap } from "~/components/ui/motion";
import * as schema from "~/db/schema";
import {
  type ToolActivityItem,
  buildLiveActivity,
  formatToolArguments,
} from "~/features/ingestion/live-activity";
import { useIngestionAgent } from "~/features/ingestion/use-ingestion-agent";
import { requireUser } from "~/lib/auth-utils.server";
import type { ExtractedUrl } from "~/lib/url-extract";
import type { IngestionStatus } from "../../shared/ingestion/agent-state";
import type {
  AiDraftJson,
  ChangesetOperation,
  ClarificationQuestion,
} from "../../shared/ingestion/domain";
import type { IngestionRealtimeEvent } from "../../shared/ingestion/realtime-events";

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
  events,
  t,
}: {
  phaseMessage: string | null;
  events: IngestionRealtimeEvent[];
  t: (k: string) => string;
}) {
  const activeStep = getActiveStep(phaseMessage);
  const stepLabels = [
    t("ingest.phase_step_1"),
    t("ingest.phase_step_2"),
    t("ingest.phase_step_3"),
    t("ingest.phase_step_4"),
  ];
  const activity = buildLiveActivity(events);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-gray-50">
      <div className="h-12 w-12 animate-spin rounded-full border-4 border-blue-200 border-t-blue-600 motion-reduce:animate-none" />
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
                  <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-blue-600 motion-reduce:animate-none" />
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
      {activity.length > 0 && (
        <div
          className="w-full max-w-xl px-4"
          aria-live="polite"
          aria-label="Live generation activity"
        >
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-500">
            Live activity
          </p>
          <ul className="space-y-2">
            {activity.map((item) =>
              item.kind === "tool" ? (
                <ToolActivityCard key={item.key} activity={item} />
              ) : (
                <li key={item.key} className="text-xs text-gray-500">
                  {eventDescription(item.event)}
                </li>
              ),
            )}
          </ul>
        </div>
      )}
      <p className="text-sm text-gray-500">{t("ingest.processing_hint")}</p>
      <p className="text-xs text-gray-400">{t("ingest.processing_leave_hint")}</p>
    </div>
  );
}

function ToolActivityCard({ activity }: { activity: ToolActivityItem }) {
  const statusLabel =
    activity.status === "running"
      ? "Running"
      : activity.status === "completed"
        ? "Completed"
        : "Failed";
  const statusClass =
    activity.status === "running"
      ? "bg-blue-50 text-blue-700"
      : activity.status === "completed"
        ? "bg-green-50 text-green-700"
        : "bg-red-50 text-red-700";

  return (
    <li className="rounded-lg border border-gray-200 bg-white p-3 text-xs text-gray-600 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <code className="font-semibold text-gray-900">{activity.tool}</code>
        <span className={`rounded-full px-2 py-0.5 font-medium ${statusClass}`}>{statusLabel}</span>
      </div>
      {activity.summary && <p className="mt-1 text-gray-500">{activity.summary}</p>}
      <pre className="mt-2 whitespace-pre-wrap break-all rounded-md bg-gray-50 p-2 font-mono text-[11px] leading-4 text-gray-700">
        {formatToolArguments(activity.args)}
      </pre>
      {(activity.durationMs !== undefined ||
        activity.truncated ||
        activity.errorCode !== undefined) && (
        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-gray-500">
          {activity.durationMs !== undefined && <span>{activity.durationMs} ms</span>}
          {activity.truncated && <span>Output truncated</span>}
          {activity.errorCode !== undefined && <span>{activity.errorCode}</span>}
        </div>
      )}
    </li>
  );
}

function eventDescription(event: IngestionRealtimeEvent): string {
  switch (event.type) {
    case "workflow_started":
      return "Generation started";
    case "model_started":
      return `Running ${event.program}`;
    case "model_step":
      return `${event.program}: step ${event.step} of ${event.limit}`;
    case "tool_started":
      return displaySafeSummary(event.summary);
    case "tool_completed":
      return `${event.tool} completed`;
    case "tool_failed":
      return `${event.tool} could not complete`;
    case "operation_started":
      return `Preparing operation ${event.index + 1} of ${event.total}`;
    case "operation_completed":
      return `Prepared operation ${event.index + 1} of ${event.total}`;
    case "awaiting_input":
      return "Waiting for your input";
    case "completed":
      return "Generation completed";
    case "failed":
      return "Generation could not complete";
  }
}

function displaySafeSummary(summary: string): string {
  const compact = summary.replaceAll(/\s+/g, " ").trim();
  return compact.length > 160 ? `${compact.slice(0, 157)}…` : compact;
}

// ---------------------------------------------------------------------------
// Clarification UI
// ---------------------------------------------------------------------------

function ClarificationScreen({
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
  const revalidator = useRevalidator();
  const {
    agent: generationAgent,
    client: generationClient,
    events,
  } = useIngestionAgent(loaderData.sessionId);
  const imageKeys = loaderData.imageKeys;
  const [optimisticStatus, setOptimisticStatus] = useState<IngestionStatus | null>(null);
  const [sensitiveResolved, setSensitiveResolved] = useState(false);
  const [resolvedDraft, setResolvedDraft] = useState<ResultDraft | null>(null);
  const [showToast, setShowToast] = useState(false);
  const lastRevision = useRef<number | null>(null);
  const previousStatus = useRef<string | null>(null);

  const agentState =
    generationAgent.state?.sessionId === loaderData.sessionId ? generationAgent.state : undefined;
  const status = agentState?.status ?? optimisticStatus ?? loaderData.status;
  const draft = loaderData.draft;
  const phaseMessage = agentState?.phaseMessage ?? loaderData.phaseMessage;
  const errorMessage = agentState?.errorMessage ?? loaderData.errorMessage;

  // The Agent state is deliberately small; a new revision means the workflow
  // wrote a durable session change, so refresh the loader for the full draft.
  useEffect(() => {
    if (agentState?.revision === undefined || lastRevision.current === agentState.revision) return;
    lastRevision.current = agentState.revision;
    revalidator.revalidate();
  }, [agentState?.revision, revalidator]);

  useEffect(() => {
    if (previousStatus.current === "processing" && status === "done") {
      setShowToast(true);
    }
    previousStatus.current = status;
  }, [status]);

  // D1 remains authoritative. Poll only while the realtime transport is
  // unavailable so rolling deploys and transient WebSocket failures recover.
  useEffect(() => {
    if (generationAgent.identified || status !== "processing") return;
    const timer = window.setInterval(() => revalidator.revalidate(), 5_000);
    return () => window.clearInterval(timer);
  }, [generationAgent.identified, revalidator, status]);

  async function postIngestionAction(path: string, body: unknown): Promise<void> {
    const response = await fetch(`/api/ingest/${loaderData.sessionId}/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (response.ok) return;
    const text = await response.text().catch(() => "");
    throw new Error(text || `Error ${response.status}`);
  }

  async function submitClarification(
    answers: Array<{ id: string; question: string; answer: string }>,
  ): Promise<void> {
    if (generationAgent.identified) {
      await generationClient.submitClarification({ answers });
    } else {
      await postIngestionAction("clarify", { answers });
    }
    setOptimisticStatus("processing");
    revalidator.revalidate();
  }

  async function selectUrls(selectedUrls: string[]): Promise<void> {
    if (generationAgent.identified) {
      await generationClient.selectUrls({ selectedUrls });
    } else {
      await postIngestionAction("select-urls", { selectedUrls });
    }
    setOptimisticStatus("processing");
    revalidator.revalidate();
  }

  async function regenerateOperation(input: {
    operationIndex: number;
    feedback: string;
  }): Promise<{ operation: ChangesetOperation } | null> {
    if (!generationAgent.identified) return null;
    try {
      return await generationClient.regenerateOperation(input);
    } catch (error) {
      // The HTTP endpoint remains an intentionally compatible fallback while
      // clients reconnect or an Agent deployment is rolling out.
      console.warn("Agent regeneration RPC failed; falling back to HTTP", error);
      return null;
    }
  }

  // Processing state
  if (status === "processing") {
    return <ProcessingScreen phaseMessage={phaseMessage ?? null} events={events} t={t} />;
  }

  // Clarification state
  if (status === "awaiting_clarification" && isClarification(draft)) {
    return (
      <ClarificationScreen
        questions={draft.questions}
        summary={draft.summary}
        onSubmitted={submitClarification}
        t={t}
      />
    );
  }

  // URL selection state
  if (status === "awaiting_url_selection" && isUrlSelection(draft)) {
    return <UrlSelectionScreen urls={draft.urls} onSubmitted={selectUrls} t={t} />;
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
        onRegenerate={regenerateOperation}
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
