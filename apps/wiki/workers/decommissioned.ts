import { DurableObject, WorkflowEntrypoint } from "cloudflare:workers";

export class WikiGenerationAgent extends DurableObject<Env> {
  async fetch(): Promise<Response> {
    return new Response("Gone: wiki generation was removed", { status: 410 });
  }
}

export class WikiGenerationPhaseWorkflow extends WorkflowEntrypoint<Env, unknown> {
  async run(): Promise<void> {}
}
