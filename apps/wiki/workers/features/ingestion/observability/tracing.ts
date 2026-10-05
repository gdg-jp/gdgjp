import type { GenerationTraceContext } from "./generation-trace-context";

export type GenerationSpanAttribute = string | number | boolean | undefined;

export interface GenerationSpan {
  readonly isTraced?: boolean;
  setAttribute(key: string, value: GenerationSpanAttribute): void;
}

/** Compatible with `tracing` from `cloudflare:workers` and `ctx.tracing`. */
export interface GenerationTracing {
  enterSpan<T>(name: string, callback: (span: GenerationSpan) => T): T;
}

const NOOP_SPAN: GenerationSpan = { setAttribute: () => undefined };

function setAttributes(
  span: GenerationSpan,
  attributes: Record<string, GenerationSpanAttribute>,
): void {
  for (const [key, value] of Object.entries(attributes)) {
    try {
      span.setAttribute(key, value);
    } catch {
      // Attributes are optional diagnostics and must not affect the operation.
    }
  }
}

/**
 * Wraps Cloudflare's `tracing.enterSpan`. The underlying API handles automatic
 * parent-child relationships through async context; this only adds safe,
 * low-cardinality correlation attributes and an unavailable-runtime fallback.
 */
export function enterGenerationSpan<T>(
  tracing: GenerationTracing | undefined,
  name: string,
  context: GenerationTraceContext,
  attributes: Record<string, GenerationSpanAttribute>,
  callback: () => T,
): T {
  if (!tracing) return callback();
  let callbackEntered = false;
  try {
    return tracing.enterSpan(name, (span) => {
      callbackEntered = true;
      setAttributes(span, {
        "generation.session_id": context.sessionId,
        "generation.workflow_id": context.workflowId,
        "generation.run_id": context.runId,
        "generation.phase": context.phase,
        ...attributes,
      });
      return callback();
    });
  } catch (error) {
    // A tracing API failure must be transparent. Errors from the business
    // callback itself retain their original behavior and are not retried.
    if (callbackEntered) throw error;
    return callback();
  }
}
