import { tracing } from "cloudflare:workers";
import { AgentWorkflow } from "agents/workflows";
import type { AgentWorkflowEvent, AgentWorkflowStep } from "agents/workflows";
import type { IngestionAgentState } from "../../shared/ingestion/agent-state";
import type { PhaseOutcome, WorkflowPhase } from "../../shared/ingestion/public-results";
import type { IngestionRealtimeEvent } from "../../shared/ingestion/realtime-events";
import type { WikiGenerationAgent } from "../agents/wiki-generation-agent";
import { createIngestionApplication } from "../features/ingestion/composition.server";
import {
  createGenerationObservability,
  createGenerationTraceContext,
} from "../features/ingestion/observability";
import type { ExecutionEventSink } from "../features/ingestion/orchestration/ports/tool-event-sink";

export interface GenerationPhaseWorkflowParams {
  sessionId: string;
  userId: string;
  phase: WorkflowPhase;
}

interface GenerationPhaseProgress {
  step: WorkflowPhase;
  status: "processing" | "complete" | "error";
}

function outcomeState(
  outcome: PhaseOutcome,
): Pick<IngestionAgentState, "status" | "phase" | "phaseMessage" | "progress"> {
  switch (outcome.kind) {
    case "awaiting_url_selection":
      return {
        status: "awaiting_url_selection",
        phase: "url_selection",
        phaseMessage: null,
        progress: null,
      };
    case "awaiting_clarification":
      return {
        status: "awaiting_clarification",
        phase: "clarification",
        phaseMessage: null,
        progress: null,
      };
    case "completed":
      return { status: "done", phase: "completed", phaseMessage: null, progress: null };
  }
}

export class WikiGenerationPhaseWorkflow extends AgentWorkflow<
  WikiGenerationAgent,
  GenerationPhaseWorkflowParams,
  GenerationPhaseProgress,
  Env
> {
  override async run(
    event: AgentWorkflowEvent<GenerationPhaseWorkflowParams>,
    step: AgentWorkflowStep,
  ): Promise<PhaseOutcome> {
    const { sessionId, userId, phase } = event.payload;
    const runId = crypto.randomUUID();
    const trace = createGenerationTraceContext({
      sessionId,
      workflowId: this.workflowId,
      runId,
      phase,
    });
    const observability = createGenerationObservability(this.env, tracing);
    const events: ExecutionEventSink = {
      emit: (realtimeEvent: IngestionRealtimeEvent) => {
        this.broadcastToClients(realtimeEvent);
      },
    };

    await events.emit({ type: "workflow_started", workflowId: this.workflowId, phase });
    observability.event("workflow_started", trace, { outcome: "processing" });
    await this.reportProgress({ step: phase, status: "processing" });

    const startedAt = Date.now();
    let outcome: PhaseOutcome;
    try {
      outcome = await step.do(
        `execute-${phase}`,
        {
          retries: { limit: 0, delay: "1 minute", backoff: "exponential" },
          timeout: "15 minutes",
        },
        () =>
          createIngestionApplication(this.env).executePhase(
            { sessionId, userId, phase, workflowId: this.workflowId, runId },
            events,
          ),
      );
    } catch (error) {
      observability.event(
        "workflow_failed",
        trace,
        { outcome: "error", durationMs: Date.now() - startedAt, data: { error } },
        "error",
      );
      throw error;
    }

    await step.mergeAgentState({
      sessionId,
      workflowId: this.workflowId,
      errorMessage: null,
      ...outcomeState(outcome),
    });
    await this.reportProgress({ step: phase, status: "complete" });
    observability.event("workflow_completed", trace, {
      outcome: outcome.kind,
      durationMs: Date.now() - startedAt,
    });
    await step.reportComplete(outcome);
    return outcome;
  }
}
