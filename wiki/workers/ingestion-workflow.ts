import { AgentWorkflow } from "agents/workflows";
import type { AgentWorkflowEvent, AgentWorkflowStep, ApprovalEventPayload } from "agents/workflows";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "../app/db/schema";
import type { IngestionResumeMode } from "../app/lib/ingestion-jobs.server";
import { processIngestionMessage } from "../app/lib/queue-processors.server";
import type { WikiIngestionAgent } from "./ingestion-agent";

interface IngestionWorkflowParams {
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

export class IngestionWorkflow extends AgentWorkflow<
  WikiIngestionAgent,
  IngestionWorkflowParams,
  { step: string; status: "running" | "pending" | "complete" | "error" },
  Env
> {
  override async run(
    event: AgentWorkflowEvent<IngestionWorkflowParams>,
    step: AgentWorkflowStep,
  ): Promise<{ sessionId: string; status: SessionStatus }> {
    const { sessionId, userId } = event.payload;
    let status = await this.runPhase(step, "initial", sessionId, userId, "initial");

    if (status === "awaiting_url_selection") {
      await this.reportProgress({ step: "url_selection", status: "pending" });
      const approval = await this.waitForApproval<ApprovalEventPayload>(step, {
        stepName: "wait-for-url-selection",
      });
      if (approval.metadata?.kind !== "url_selection") {
        throw new Error("Unexpected URL selection approval payload");
      }
      status = await this.runPhase(
        step,
        "post-url-selection",
        sessionId,
        userId,
        "post_url_selection",
      );
    }

    if (status === "awaiting_clarification") {
      await this.reportProgress({ step: "clarification", status: "pending" });
      const approval = await this.waitForApproval<ApprovalEventPayload>(step, {
        stepName: "wait-for-clarification",
      });
      if (approval.metadata?.kind !== "clarification") {
        throw new Error("Unexpected clarification approval payload");
      }
      status = await this.runPhase(
        step,
        "post-clarification",
        sessionId,
        userId,
        "post_clarification",
      );
    }

    if (status === "error" || status === "processing") {
      throw new Error(`Ingestion workflow ended in ${status}`);
    }

    await this.reportProgress({ step: "done", status: "complete" });
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
    await this.reportProgress({ step: stepName, status: "running" });
    return step.do(
      stepName,
      {
        retries: { limit: 3, delay: "5 seconds", backoff: "exponential" },
        timeout: "15 minutes",
      },
      async () => {
        const db = drizzle(this.env.DB, { schema });
        await processIngestionMessage(this.env, db, { sessionId, userId, resumeMode });
        const row = await db
          .select({ status: schema.ingestionSessions.status })
          .from(schema.ingestionSessions)
          .where(eq(schema.ingestionSessions.id, sessionId))
          .get();
        if (!row) throw new Error("Ingestion session disappeared during workflow execution");
        return row.status as SessionStatus;
      },
    );
  }
}
