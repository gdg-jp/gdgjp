import { AgentWorkflow } from "agents/workflows";
import type { AgentWorkflowEvent, AgentWorkflowStep } from "agents/workflows";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "../app/db/schema";
import { executeIngestionPhase } from "../app/features/ingestion/execution.server";
import type { IngestionResumeMode } from "../app/features/ingestion/session.server";
import { assertWorkflowApprovalKind } from "../app/features/ingestion/workflow-approval";
import type { WikiGenerationAgent } from "./generation-agent";

interface GenerationWorkflowParams {
  sessionId: string;
  userId: string;
}

type SessionStatus =
  | "processing"
  | "awaiting_url_selection"
  | "awaiting_clarification"
  | "done"
  | "error"
  | "archived";

type WorkflowProgress = {
  step: string;
  status: "processing" | "awaiting_url_selection" | "awaiting_clarification" | "done" | "error";
};

export class WikiGenerationWorkflow extends AgentWorkflow<
  WikiGenerationAgent,
  GenerationWorkflowParams,
  WorkflowProgress,
  Env
> {
  override async run(
    event: AgentWorkflowEvent<GenerationWorkflowParams>,
    step: AgentWorkflowStep,
  ): Promise<{ sessionId: string; status: SessionStatus }> {
    const { sessionId, userId } = event.payload;
    let status = await this.runPhase(step, "initial", sessionId, userId, "initial");

    if (status === "awaiting_url_selection") {
      await this.reportProgress({ step: "url_selection", status });
      const approval = await this.waitForApproval(step, {
        stepName: "wait-for-url-selection",
      });
      assertWorkflowApprovalKind(approval, "url_selection");
      status = await this.runPhase(
        step,
        "post-url-selection",
        sessionId,
        userId,
        "post_url_selection",
      );
    }

    if (status === "awaiting_clarification") {
      await this.reportProgress({ step: "clarification", status });
      const approval = await this.waitForApproval(step, {
        stepName: "wait-for-clarification",
      });
      assertWorkflowApprovalKind(approval, "clarification");
      status = await this.runPhase(
        step,
        "post-clarification",
        sessionId,
        userId,
        "post_clarification",
      );
    }

    if (status === "error" || status === "processing") {
      throw new Error(`Generation workflow ended in ${status}`);
    }

    await step.mergeAgentState({
      sessionId,
      status,
      phaseMessage: null,
      errorMessage: null,
    });
    await this.reportProgress({ step: "done", status: "done" });
    const result = { sessionId, status };
    await step.reportComplete(result);
    return result;
  }

  private async runPhase(
    step: AgentWorkflowStep,
    stepName: string,
    sessionId: string,
    userId: string,
    resumeMode: IngestionResumeMode,
  ): Promise<SessionStatus> {
    await this.reportProgress({ step: stepName, status: "processing" });
    const status = await step.do(
      stepName,
      {
        // This step can use most of the free-plan subrequest budget. Replaying
        // the entire phase after a provider error exhausts the per-instance
        // limit, so provider calls fail once and preserve the original error.
        retries: { limit: 0, delay: "1 minute", backoff: "exponential" },
        timeout: "15 minutes",
      },
      async () => {
        const db = drizzle(this.env.DB, { schema });
        await executeIngestionPhase(this.env, db, { sessionId, userId, resumeMode });
        const row = await db
          .select({ status: schema.ingestionSessions.status })
          .from(schema.ingestionSessions)
          .where(eq(schema.ingestionSessions.id, sessionId))
          .get();
        if (!row) throw new Error("Ingestion session disappeared during workflow execution");
        return row.status as SessionStatus;
      },
    );
    await step.mergeAgentState({
      sessionId,
      status,
      phaseMessage: status === "processing" ? stepName : null,
      errorMessage: null,
    });
    return status;
  }
}
