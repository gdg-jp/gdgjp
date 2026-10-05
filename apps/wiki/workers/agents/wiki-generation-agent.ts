import { tracing } from "cloudflare:workers";
import { Agent, type Connection, callable } from "agents";
import { z } from "zod";
import type { IngestionAgentState, IngestionSnapshot } from "../../shared/ingestion/agent-state";
import type {
  ClarificationCommand,
  SelectUrlsCommand,
  StartIngestionCommand,
} from "../../shared/ingestion/commands";
import type { WorkflowPhase } from "../../shared/ingestion/public-results";
import type { IngestionRealtimeEvent } from "../../shared/ingestion/realtime-events";
import {
  createGenerationObservability,
  createGenerationTraceContext,
} from "../features/ingestion/observability";
import {
  prepareClarificationResume,
  prepareUrlSelectionResume,
  rollbackResume,
} from "../features/ingestion/orchestration/resume-ingestion";
import { D1IngestionSessionRepository } from "../features/ingestion/persistence/d1/ingestion-session-repository";
import { persistIngestionError } from "../features/ingestion/persistence/ingestion-result-writer.server";
import { regenerateDraftOperation } from "../features/ingestion/regenerate-operation.server";

export type WikiGenerationAgentState = IngestionAgentState;

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

export class WikiGenerationAgent extends Agent<Env, WikiGenerationAgentState> {
  initialState: WikiGenerationAgentState = {
    sessionId: null,
    workflowId: null,
    phase: null,
    status: "idle",
    progress: null,
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

  @callable()
  async startIngestion(
    input: StartIngestionCommand | string,
    legacyUserId?: string,
  ): Promise<{ sessionId: string; workflowId: string }> {
    const sessionId = typeof input === "string" ? input : input.sessionId;
    const sessions = this.sessions();
    const session = await sessions.findById(sessionId);

    if (!session || (legacyUserId && session.userId !== legacyUserId)) {
      throw new Error("Ingestion session not found");
    }
    if (session.workflowId) {
      await this.syncFromDatabase(session.workflowId);
      return { sessionId, workflowId: session.workflowId };
    }
    if (session.status !== "processing") {
      throw new Error(`Ingestion session is not processable: ${session.status}`);
    }

    const workflowId = this.createWorkflowId(sessionId, "initial");
    const reserved = await sessions.setWorkflowIdIfMissing(sessionId, workflowId);
    if (!reserved) {
      const current = await sessions.findById(sessionId);
      if (!current?.workflowId) throw new Error("Unable to reserve ingestion workflow");
      await this.syncFromDatabase(current.workflowId);
      return { sessionId, workflowId: current.workflowId };
    }
    try {
      await this.startPhaseWorkflow(sessionId, session.userId, "initial", workflowId);
    } catch (error) {
      await sessions.clearWorkflowIdIfCurrent(sessionId, workflowId);
      throw error;
    }
    this.updateState({
      sessionId,
      workflowId,
      phase: "initial",
      status: "processing",
      progress: null,
      phaseMessage: "starting",
      errorMessage: null,
    });
    this.log("workflow_started", { sessionId, workflowId });
    return { sessionId, workflowId };
  }

  @callable()
  async submitClarification(input: ClarificationCommand | unknown): Promise<{ accepted: true }> {
    const { answers } = ClarificationInputSchema.parse(input);
    const sessions = this.sessions();
    const resume = await prepareClarificationResume(
      sessions,
      this.state.sessionId ?? this.name,
      answers,
    );
    try {
      const workflowId = this.createWorkflowId(resume.sessionId, "post_clarification");
      await sessions.setWorkflowId(resume.sessionId, workflowId);
      await this.startPhaseWorkflow(
        resume.sessionId,
        resume.userId,
        "post_clarification",
        workflowId,
      );
      this.updateState({
        sessionId: resume.sessionId,
        workflowId,
        phase: "post_clarification",
        status: "processing",
        progress: null,
        phaseMessage: "planning",
        errorMessage: null,
      });
    } catch (error) {
      await rollbackResume(sessions, resume);
      throw error;
    }
    return { accepted: true };
  }

  @callable()
  async selectUrls(input: SelectUrlsCommand | unknown): Promise<{ accepted: true }> {
    const { selectedUrls } = UrlSelectionInputSchema.parse(input);
    const sessions = this.sessions();
    const resume = await prepareUrlSelectionResume(
      sessions,
      this.state.sessionId ?? this.name,
      selectedUrls,
    );
    try {
      const workflowId = this.createWorkflowId(resume.sessionId, "post_url_selection");
      await sessions.setWorkflowId(resume.sessionId, workflowId);
      await this.startPhaseWorkflow(
        resume.sessionId,
        resume.userId,
        "post_url_selection",
        workflowId,
      );
      this.updateState({
        sessionId: resume.sessionId,
        workflowId,
        phase: "post_url_selection",
        status: "processing",
        progress: null,
        phaseMessage: "fetching_urls",
        errorMessage: null,
      });
    } catch (error) {
      await rollbackResume(sessions, resume);
      throw error;
    }
    return { accepted: true };
  }

  @callable()
  async regenerateOperation(
    input: unknown,
  ): Promise<{ operation: import("../../shared/ingestion/domain").ChangesetOperation }> {
    const params = RegenerateInputSchema.parse(input);
    const session = await this.getOwnedSession();
    const trace = createGenerationTraceContext({
      sessionId: session.id,
      workflowId: session.workflowId ?? `regeneration:${session.id}`,
      phase: "regeneration",
    });
    const observability = createGenerationObservability(this.env, tracing);
    this.emitRealtime({
      type: "operation_started",
      index: params.operationIndex,
      total: 1,
      operationType: "regeneration",
    });
    const startedAt = Date.now();
    const operation = await observability.span(
      "generation.regenerate",
      trace,
      { "generation.operation_index": params.operationIndex },
      async () => {
        observability.event("regeneration_started", trace, {
          operationIndex: params.operationIndex,
          outcome: "processing",
        });
        try {
          const result = await regenerateDraftOperation(
            this.env,
            session.id,
            session.userId,
            params,
            { emit: (event) => this.emitRealtime(event) },
            observability,
            trace,
          );
          observability.event("regeneration_completed", trace, {
            operationIndex: params.operationIndex,
            outcome: "success",
            durationMs: Date.now() - startedAt,
          });
          return result;
        } catch (error) {
          observability.event(
            "regeneration_failed",
            trace,
            {
              operationIndex: params.operationIndex,
              outcome: "error",
              durationMs: Date.now() - startedAt,
              data: { error },
            },
            "error",
          );
          throw error;
        }
      },
    );
    this.emitRealtime({ type: "operation_completed", index: params.operationIndex, total: 1 });
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
    if (data.status !== "processing") return;
    const phaseMessage = typeof data.step === "string" ? data.step : this.state.phaseMessage;
    const phase = this.toPhase(data.step) ?? this.state.phase;
    this.updateState({ workflowId, status: "processing", phase, phaseMessage });
  }

  override async onWorkflowComplete(_workflowName: string, workflowId: string): Promise<void> {
    await this.syncFromDatabase(workflowId);
  }

  override async onWorkflowError(
    _workflowName: string,
    workflowId: string,
    error: string,
  ): Promise<void> {
    const sessionId = this.state.sessionId ?? this.name;
    const session = await this.sessions().findById(sessionId);
    if (session) await persistIngestionError(this.env, sessionId, session.userId, error);
    this.emitRealtime({ type: "failed", errorCode: "workflow_failed" });
    await this.syncFromDatabase(workflowId);
    this.log("workflow_failed", { sessionId, workflowId, errorType: "workflow" });
  }

  async syncFromDatabase(workflowId = this.state.workflowId): Promise<void> {
    const sessionId = this.state.sessionId ?? this.name;
    const session = await this.sessions().findById(sessionId);
    if (!session) return;
    this.updateState({
      sessionId,
      workflowId,
      status: this.toAgentStatus(session.status),
      phase: this.phaseFromStatus(session.status, session.phaseMessage),
      progress: null,
      phaseMessage: session.phaseMessage,
      errorMessage: session.errorMessage,
    });
  }

  private async getOwnedSession() {
    const sessionId = this.state.sessionId ?? this.name;
    const session = await this.sessions().findById(sessionId);
    if (!session) throw new Error("Ingestion session not found");
    return session;
  }

  private updateState(patch: Partial<WikiGenerationAgentState>): void {
    this.setState({ ...this.state, ...patch, revision: this.state.revision + 1 });
  }

  @callable()
  async getSnapshot(): Promise<IngestionSnapshot> {
    const sessionId = this.state.sessionId ?? this.name;
    const session = await this.sessions().findById(sessionId);
    if (!session) throw new Error("Ingestion session not found");
    return {
      sessionId,
      workflowId: session.workflowId,
      phase: this.phaseFromStatus(session.status, session.phaseMessage),
      status: this.toAgentStatus(session.status),
      progress: null,
      phaseMessage: session.phaseMessage,
      errorMessage: session.errorMessage,
      revision: this.state.revision,
    };
  }

  private startPhaseWorkflow(
    sessionId: string,
    userId: string,
    phase: WorkflowPhase,
    workflowId: string,
  ): Promise<string> {
    return this.runWorkflow(
      "GENERATION_WORKFLOW",
      { sessionId, userId, phase },
      {
        id: workflowId,
        agentBinding: "WikiGenerationAgent",
        metadata: { sessionId, userId, phase, kind: "wiki-generation" },
      },
    );
  }

  private createWorkflowId(sessionId: string, phase: WorkflowPhase): string {
    return `${sessionId}-${phase}-${crypto.randomUUID()}`;
  }

  private sessions(): D1IngestionSessionRepository {
    return new D1IngestionSessionRepository(this.env.DB);
  }

  private emitRealtime(event: IngestionRealtimeEvent): void {
    this.broadcast(JSON.stringify(event));
  }

  private phaseFromStatus(
    status: string,
    phaseMessage: string | null,
  ): WikiGenerationAgentState["phase"] {
    switch (status) {
      case "awaiting_url_selection":
        return "url_selection";
      case "awaiting_clarification":
        return "clarification";
      case "done":
        return "completed";
      case "error":
        return "failed";
      default:
        return this.toPhase(phaseMessage) ?? this.state.phase;
    }
  }

  private toPhase(value: unknown): WikiGenerationAgentState["phase"] {
    switch (value) {
      case "initial":
      case "post_url_selection":
      case "post_clarification":
      case "regeneration":
      case "url_selection":
      case "clarification":
      case "completed":
      case "failed":
        return value;
      default:
        return null;
    }
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
