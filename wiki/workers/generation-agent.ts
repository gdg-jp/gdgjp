import { Agent, type Connection, callable } from "agents";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { z } from "zod";
import * as schema from "../app/db/schema";
import type {
  AiDraftJson,
  GenerationAgentState,
  IngestionResumePostClarificationDraft,
  IngestionResumePostUrlSelectionDraft,
} from "../app/features/ingestion/contracts";
import { persistIngestionError } from "../app/features/ingestion/persistence.server";
import { regenerateDraftOperation } from "../app/features/ingestion/regenerate.server";

export type WikiGenerationAgentState = GenerationAgentState;

const ClarificationInputSchema = z.object({
  answers: z
    .array(
      z.object({
        id: z.string(),
        question: z.string(),
        answer: z.string(),
      }),
    )
    .max(4),
});

const UrlSelectionInputSchema = z.object({
  selectedUrls: z.array(z.string().url()).max(5),
});

const RegenerateInputSchema = z.object({
  operationIndex: z.number().int().min(0),
  feedback: z.string().max(4_000).optional(),
});

function parseDraft(value: string | null): AiDraftJson | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as AiDraftJson;
  } catch {
    return null;
  }
}

export class WikiGenerationAgent extends Agent<Env, WikiGenerationAgentState> {
  initialState: WikiGenerationAgentState = {
    sessionId: null,
    workflowId: null,
    status: "idle",
    phaseMessage: null,
    errorMessage: null,
    revision: 0,
  };

  override validateStateChange(
    _nextState: WikiGenerationAgentState,
    source: Connection | "server",
  ): void {
    if (source !== "server") {
      throw new Error("Generation state is server-managed");
    }
  }

  async startIngestion(sessionId: string, userId: string): Promise<string> {
    const db = drizzle(this.env.DB, { schema });
    const session = await db
      .select({
        userId: schema.ingestionSessions.userId,
        status: schema.ingestionSessions.status,
        workflowId: schema.ingestionSessions.workflowId,
      })
      .from(schema.ingestionSessions)
      .where(eq(schema.ingestionSessions.id, sessionId))
      .get();

    if (!session || session.userId !== userId) throw new Error("Ingestion session not found");
    if (session.workflowId) return session.workflowId;
    if (session.status !== "processing") {
      throw new Error(`Ingestion session is not processable: ${session.status}`);
    }

    const workflowId = await this.runWorkflow(
      "GENERATION_WORKFLOW",
      { sessionId, userId },
      {
        id: sessionId,
        agentBinding: "GENERATION_AGENT",
        metadata: { sessionId, userId, kind: "wiki-generation" },
      },
    );
    await db
      .update(schema.ingestionSessions)
      .set({ workflowId, updatedAt: new Date() })
      .where(eq(schema.ingestionSessions.id, sessionId));
    this.updateState({
      sessionId,
      workflowId,
      status: "processing",
      phaseMessage: "starting",
      errorMessage: null,
    });
    this.log("workflow_started", { sessionId, workflowId });
    return workflowId;
  }

  @callable()
  async submitClarification(input: unknown): Promise<{ ok: true }> {
    const { answers } = ClarificationInputSchema.parse(input);
    const db = drizzle(this.env.DB, { schema });
    const session = await this.getOwnedSession();
    if (session.status !== "awaiting_clarification" || !session.workflowId) {
      throw new Error("Session is not awaiting clarification");
    }
    const storedDraft = parseDraft(session.aiDraftJson);
    if (!storedDraft || storedDraft.phase !== "clarification") {
      throw new Error("Invalid stored clarification state");
    }
    const clarificationAnswers = [
      "## 補足情報（ユーザーへの確認結果）",
      ...answers.map((answer) => `Q: ${answer.question}\nA: ${answer.answer}`),
    ].join("\n");
    const resumeDraft: IngestionResumePostClarificationDraft = {
      phase: "resume_post_clarification",
      fileUris: storedDraft.fileUris,
      clarificationAnswers,
      googleDocText: storedDraft.googleDocText,
      sourceArtifactKey: storedDraft.sourceArtifactKey,
      sources: storedDraft.sources,
    };
    await db
      .update(schema.ingestionSessions)
      .set({
        status: "processing",
        aiDraftJson: JSON.stringify(resumeDraft),
        phaseMessage: "parsing",
        updatedAt: new Date(),
      })
      .where(eq(schema.ingestionSessions.id, session.id));
    try {
      await this.approveWorkflow(session.workflowId, {
        reason: "clarification",
        metadata: { kind: "clarification" },
      });
    } catch (error) {
      await db
        .update(schema.ingestionSessions)
        .set({
          status: "awaiting_clarification",
          aiDraftJson: session.aiDraftJson,
          phaseMessage: null,
          updatedAt: new Date(),
        })
        .where(eq(schema.ingestionSessions.id, session.id));
      throw error;
    }
    this.updateState({
      sessionId: session.id,
      workflowId: session.workflowId,
      status: "processing",
      phaseMessage: "planning",
      errorMessage: null,
    });
    return { ok: true };
  }

  @callable()
  async selectUrls(input: unknown): Promise<{ ok: true }> {
    const { selectedUrls } = UrlSelectionInputSchema.parse(input);
    const db = drizzle(this.env.DB, { schema });
    const session = await this.getOwnedSession();
    if (session.status !== "awaiting_url_selection" || !session.workflowId) {
      throw new Error("Session is not awaiting URL selection");
    }
    const storedDraft = parseDraft(session.aiDraftJson);
    if (!storedDraft || storedDraft.phase !== "url_selection") {
      throw new Error("Invalid stored URL selection state");
    }
    const allowed = new Set(storedDraft.urls.map((url) => url.url));
    if (selectedUrls.some((url) => !allowed.has(url))) {
      throw new Error("Selected URLs are not in the allowed list");
    }
    const resumeDraft: IngestionResumePostUrlSelectionDraft = {
      phase: "resume_post_url_selection",
      fileUris: storedDraft.fileUris,
      selectedUrls,
      googleDocText: storedDraft.googleDocText,
      sourceArtifactKey: storedDraft.sourceArtifactKey,
    };
    await db
      .update(schema.ingestionSessions)
      .set({
        status: "processing",
        aiDraftJson: JSON.stringify(resumeDraft),
        phaseMessage: "fetching_urls",
        updatedAt: new Date(),
      })
      .where(eq(schema.ingestionSessions.id, session.id));
    try {
      await this.approveWorkflow(session.workflowId, {
        reason: "url_selection",
        metadata: { kind: "url_selection" },
      });
    } catch (error) {
      await db
        .update(schema.ingestionSessions)
        .set({
          status: "awaiting_url_selection",
          aiDraftJson: session.aiDraftJson,
          phaseMessage: null,
          updatedAt: new Date(),
        })
        .where(eq(schema.ingestionSessions.id, session.id));
      throw error;
    }
    this.updateState({
      sessionId: session.id,
      workflowId: session.workflowId,
      status: "processing",
      phaseMessage: "fetching_urls",
      errorMessage: null,
    });
    return { ok: true };
  }

  @callable()
  async regenerateOperation(
    input: unknown,
  ): Promise<{ operation: import("../app/features/ingestion/contracts").ChangesetOperation }> {
    const params = RegenerateInputSchema.parse(input);
    const session = await this.getOwnedSession();
    const operation = await regenerateDraftOperation(this.env, session.id, session.userId, params);
    this.updateState({
      sessionId: session.id,
      workflowId: session.workflowId,
      status: "done",
      phaseMessage: null,
      errorMessage: null,
    });
    return { operation };
  }

  override async onWorkflowProgress(
    _workflowName: string,
    workflowId: string,
    progress: unknown,
  ): Promise<void> {
    const data =
      typeof progress === "object" && progress !== null
        ? (progress as Record<string, unknown>)
        : {};
    const phaseMessage = typeof data.step === "string" ? data.step : this.state.phaseMessage;
    const status =
      data.status === "awaiting_url_selection" || data.status === "awaiting_clarification"
        ? data.status
        : "processing";
    this.updateState({ workflowId, status, phaseMessage });
  }

  override async onWorkflowComplete(_workflowName: string, workflowId: string): Promise<void> {
    await this.syncFromDatabase(workflowId);
  }

  override async onWorkflowError(
    _workflowName: string,
    workflowId: string,
    error: string,
  ): Promise<void> {
    const db = drizzle(this.env.DB, { schema });
    const sessionId = this.state.sessionId ?? this.name;
    const session = await db
      .select({ userId: schema.ingestionSessions.userId })
      .from(schema.ingestionSessions)
      .where(eq(schema.ingestionSessions.id, sessionId))
      .get();
    if (session) await persistIngestionError(this.env, sessionId, session.userId, error);
    await this.syncFromDatabase(workflowId);
    this.log("workflow_failed", { sessionId, workflowId, errorType: "workflow" });
  }

  async syncFromDatabase(workflowId = this.state.workflowId): Promise<void> {
    const db = drizzle(this.env.DB, { schema });
    const sessionId = this.state.sessionId ?? this.name;
    const session = await db
      .select({
        status: schema.ingestionSessions.status,
        phaseMessage: schema.ingestionSessions.phaseMessage,
        errorMessage: schema.ingestionSessions.errorMessage,
      })
      .from(schema.ingestionSessions)
      .where(eq(schema.ingestionSessions.id, sessionId))
      .get();
    if (!session) return;
    this.updateState({
      sessionId,
      workflowId,
      status: this.toAgentStatus(session.status),
      phaseMessage: session.phaseMessage,
      errorMessage: session.errorMessage,
    });
  }

  private async getOwnedSession() {
    const db = drizzle(this.env.DB, { schema });
    const sessionId = this.state.sessionId ?? this.name;
    const session = await db
      .select({
        id: schema.ingestionSessions.id,
        userId: schema.ingestionSessions.userId,
        status: schema.ingestionSessions.status,
        workflowId: schema.ingestionSessions.workflowId,
        aiDraftJson: schema.ingestionSessions.aiDraftJson,
      })
      .from(schema.ingestionSessions)
      .where(eq(schema.ingestionSessions.id, sessionId))
      .get();
    if (!session) throw new Error("Ingestion session not found");
    return session;
  }

  private updateState(patch: Partial<WikiGenerationAgentState>): void {
    this.setState({ ...this.state, ...patch, revision: this.state.revision + 1 });
  }

  private toAgentStatus(status: string): WikiGenerationAgentState["status"] {
    switch (status) {
      case "processing":
      case "awaiting_url_selection":
      case "awaiting_clarification":
      case "done":
      case "error":
        return status;
      default:
        return "idle";
    }
  }

  private log(event: string, fields: Record<string, unknown>): void {
    console.log(JSON.stringify({ component: "wiki-generation-agent", event, ...fields }));
  }
}
