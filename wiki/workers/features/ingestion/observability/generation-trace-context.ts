/**
 * Correlation identifiers shared by every observable action in one generation
 * attempt. These IDs are application-owned because Workflow executions do not
 * currently expose a trace ID that can be propagated across every boundary.
 */
export type GenerationTraceContext = {
  sessionId: string;
  workflowId: string;
  runId: string;
  phase?: string;
};

export type ModelCallTraceContext = GenerationTraceContext & {
  modelCallId: string;
};

export function createGenerationTraceContext(input: {
  sessionId: string;
  workflowId?: string;
  runId?: string;
  phase?: string;
}): GenerationTraceContext {
  return {
    sessionId: input.sessionId,
    workflowId: input.workflowId ?? crypto.randomUUID(),
    runId: input.runId ?? crypto.randomUUID(),
    ...(input.phase === undefined ? {} : { phase: input.phase }),
  };
}

export function withGenerationPhase(
  context: GenerationTraceContext,
  phase: string,
): GenerationTraceContext {
  return { ...context, phase };
}

export function createModelCallTraceContext(
  context: GenerationTraceContext,
  modelCallId: string = crypto.randomUUID(),
): ModelCallTraceContext {
  return { ...context, modelCallId };
}
