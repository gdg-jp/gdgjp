import { Agent } from "agents";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "../app/db/schema";

export interface IngestionAgentState {
  sessionId: string | null;
  workflowId: string | null;
  status: "idle" | "running" | "waiting" | "complete" | "error";
  phase: string | null;
  error: string | null;
}

export class WikiIngestionAgent extends Agent<Env, IngestionAgentState> {
  initialState: IngestionAgentState = {
    sessionId: null,
    workflowId: null,
    status: "idle",
    phase: null,
    error: null,
  };

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

    if (!session || session.userId !== userId) {
      throw new Error("Ingestion session not found");
    }
    if (session.workflowId) return session.workflowId;
    if (session.status !== "processing") {
      throw new Error(`Ingestion session is not processable: ${session.status}`);
    }

    const workflowId = await this.runWorkflow(
      "INGESTION_WORKFLOW",
      { sessionId, userId },
      {
        id: sessionId,
        agentBinding: "INGESTION_AGENT",
        metadata: { sessionId, userId, kind: "wiki-ingestion" },
      },
    );

    await db
      .update(schema.ingestionSessions)
      .set({ workflowId, updatedAt: new Date() })
      .where(eq(schema.ingestionSessions.id, sessionId));
    this.setState({
      sessionId,
      workflowId,
      status: "running",
      phase: "starting",
      error: null,
    });
    this.log("workflow_started", { sessionId, workflowId });
    return workflowId;
  }

  async resumeIngestion(
    sessionId: string,
    userId: string,
    kind: "url_selection" | "clarification",
  ): Promise<void> {
    const db = drizzle(this.env.DB, { schema });
    const session = await db
      .select({
        userId: schema.ingestionSessions.userId,
        workflowId: schema.ingestionSessions.workflowId,
        aiDraftJson: schema.ingestionSessions.aiDraftJson,
      })
      .from(schema.ingestionSessions)
      .where(eq(schema.ingestionSessions.id, sessionId))
      .get();
    if (!session || session.userId !== userId || !session.workflowId) {
      throw new Error("Ingestion workflow not found");
    }

    const expectedPhase =
      kind === "url_selection" ? "resume_post_url_selection" : "resume_post_clarification";
    let phase: unknown;
    try {
      phase = JSON.parse(session.aiDraftJson ?? "null")?.phase;
    } catch {
      phase = null;
    }
    if (phase !== expectedPhase) {
      throw new Error(`Ingestion resume payload is invalid for ${kind}`);
    }

    await this.approveWorkflow(session.workflowId, {
      reason: kind,
      metadata: { kind, submittedBy: userId },
    });
    this.setState({
      sessionId,
      workflowId: session.workflowId,
      status: "running",
      phase: kind === "url_selection" ? "fetching_urls" : "planning",
      error: null,
    });
    this.log("workflow_resumed", { sessionId, workflowId: session.workflowId, kind });
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
    const phase = typeof data.step === "string" ? data.step : this.state.phase;
    this.setState({
      ...this.state,
      workflowId,
      status: data.status === "pending" ? "waiting" : "running",
      phase,
    });
  }

  override async onWorkflowComplete(_workflowName: string, workflowId: string): Promise<void> {
    this.setState({ ...this.state, workflowId, status: "complete", phase: "done", error: null });
    this.log("workflow_completed", { sessionId: this.state.sessionId, workflowId });
  }

  override async onWorkflowError(
    _workflowName: string,
    workflowId: string,
    error: string,
  ): Promise<void> {
    const db = drizzle(this.env.DB, { schema });
    const sessionId = this.state.sessionId;
    if (sessionId) {
      await db
        .update(schema.ingestionSessions)
        .set({
          status: "error",
          errorMessage: "Ingestion failed due to an internal error.",
          phaseMessage: null,
          updatedAt: new Date(),
        })
        .where(eq(schema.ingestionSessions.id, sessionId));
    }
    this.setState({ ...this.state, workflowId, status: "error", phase: null, error });
    this.log("workflow_failed", { sessionId, workflowId, errorType: "workflow" });
  }

  private log(event: string, fields: Record<string, unknown>): void {
    console.log(JSON.stringify({ component: "wiki-ingestion-agent", event, ...fields }));
  }
}
