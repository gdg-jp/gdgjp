import { DurableObject, WorkflowEntrypoint } from "cloudflare:workers";

/**
 * v1 wiki generation (`/ingest`, Gemini) was removed in knowledge platform v2 Stage 07.
 * These inert classes keep the `WikiGenerationAgent` Durable Object and the
 * `GENERATION_WORKFLOW` Workflow bindings valid, so their stored state is not deleted by a
 * deploy. Retiring them (a `deleted_classes` migration) destroys that state and is an
 * operator decision; see docs/plans/knowledge-platform-v2/07-decommission.md.
 */
export class WikiGenerationAgent extends DurableObject<Env> {
  async fetch(): Promise<Response> {
    return new Response("Gone: wiki generation was removed", { status: 410 });
  }
}

export class WikiGenerationPhaseWorkflow extends WorkflowEntrypoint<Env, unknown> {
  async run(): Promise<void> {
    // Decommissioned: any leftover instance finishes without doing work.
  }
}
