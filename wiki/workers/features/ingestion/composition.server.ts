import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "../../../app/db/schema";
import type { PhaseOutcome, WorkflowPhase } from "../../../shared/ingestion/public-results";
import {
  IngestionApplication,
  type IngestionPhaseRunner,
} from "./orchestration/ingestion-application";
import type { IngestionResumeMode } from "./persistence/serialization/session-execution";
import { executeIngestionPhase } from "./phase-execution.server";

function toResumeMode(phase: WorkflowPhase): IngestionResumeMode {
  switch (phase) {
    case "initial":
      return "initial";
    case "post_url_selection":
      return "post_url_selection";
    case "post_clarification":
      return "post_clarification";
    case "regeneration":
      throw new Error("Regeneration uses the dedicated operation use case");
  }
}

/** Composition root: this is the only layer allowed to bind framework-neutral use cases to Env. */
export function createIngestionApplication(env: Env): IngestionApplication {
  const db = drizzle(env.DB, { schema });
  const phases: IngestionPhaseRunner = {
    async execute(command, events): Promise<PhaseOutcome> {
      await executeIngestionPhase(
        env,
        db,
        {
          sessionId: command.sessionId,
          userId: command.userId,
          resumeMode: toResumeMode(command.phase),
        },
        events,
      );
      const row = await db
        .select({ status: schema.ingestionSessions.status })
        .from(schema.ingestionSessions)
        .where(eq(schema.ingestionSessions.id, command.sessionId))
        .get();
      if (!row) throw new Error("Ingestion session disappeared during workflow execution");
      if (row.status === "awaiting_url_selection") {
        await events.emit({ type: "awaiting_input", input: "url_selection" });
        return { kind: "awaiting_url_selection" };
      }
      if (row.status === "awaiting_clarification") {
        await events.emit({ type: "awaiting_input", input: "clarification" });
        return { kind: "awaiting_clarification" };
      }
      if (row.status === "done") {
        await events.emit({ type: "completed" });
        return { kind: "completed" };
      }
      throw new Error(`Generation phase ended in ${row.status}`);
    },
  };
  return new IngestionApplication(phases);
}
