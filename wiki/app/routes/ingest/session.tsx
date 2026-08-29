import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLoaderData, useRevalidator } from "react-router";
import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import Toast from "~/components/Toast";
import * as schema from "~/db/schema";
import { requireUser } from "~/features/auth/utils.server";
import ChangesetReview from "~/features/ingestion/components/ChangesetReview";
import {
  ClarificationScreen,
  UrlSelectionScreen,
} from "~/features/ingestion/components/IngestInputScreens";
import { ProcessingScreen } from "~/features/ingestion/components/IngestProcessingScreen";
import SensitiveReviewModal from "~/features/ingestion/components/SensitiveReviewModal";
import type { ResolvedItem } from "~/features/ingestion/components/SensitiveReviewModal";
import {
  type ResultDraft,
  applySensitiveResolutions,
  isClarification,
  isResultDraft,
  isUrlSelection,
} from "~/features/ingestion/ingest-session-helpers";
import { useIngestionAgent } from "~/features/ingestion/use-ingestion-agent";
import type { IngestionStatus } from "../../../shared/ingestion/agent-state";
import type { AiDraftJson, ChangesetOperation } from "../../../shared/ingestion/domain";

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
        <h1 className="text-lg font-semibold text-content-primary">{t("ingest.error_heading")}</h1>
        {errorMessage && <p className="mt-2 text-sm text-content-tertiary">{errorMessage}</p>}
        <a
          href="/ingest"
          className="mt-6 inline-block rounded-lg bg-action-primary px-5 py-2.5 text-sm font-medium text-action-primary-foreground hover:bg-action-primary-hover"
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
        <p className="text-content-tertiary">{t("ingest.review_not_found")}</p>
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
        <h1 className="text-2xl font-bold text-content-primary">{t("ingest.review_heading")}</h1>
        <p className="mt-1 text-sm text-content-tertiary">{t("ingest.review_subtitle")}</p>
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
        imageKeys={imageKeys}
        pageIndex={loaderData.pageIndex}
        onRegenerate={regenerateOperation}
      />
    </div>
  );
}
