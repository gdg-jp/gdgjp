import type { ModelCallTraceContext } from "./generation-trace-context";

export type AiGatewayTelemetryEnvironment = {
  AI_GATEWAY_BASE_URL?: string;
  AI_GATEWAY_TOKEN?: string;
};

/** Request-scoped Gateway headers; provider authentication stays in the model factory. */
export function createAiGatewayTelemetryHeaders(
  env: AiGatewayTelemetryEnvironment,
  context: ModelCallTraceContext,
  program: string,
): Record<string, string> | undefined {
  if (!env.AI_GATEWAY_BASE_URL?.trim() || !env.AI_GATEWAY_TOKEN?.trim()) return undefined;
  return {
    "cf-aig-collect-log-payload": "true",
    "cf-aig-metadata": JSON.stringify({
      session_id: context.sessionId,
      workflow_id: context.workflowId,
      run_id: context.runId,
      model_call_id: context.modelCallId,
      program,
    }),
  };
}
