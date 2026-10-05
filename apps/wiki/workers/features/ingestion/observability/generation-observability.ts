import {
  type ModelCallAnalyticsRecord,
  type ModelCallAnalyticsWriter,
  createAnalyticsEngineModelCallWriter,
} from "./analytics-engine";
import type { GenerationTraceContext } from "./generation-trace-context";
import {
  type GenerationEventFields,
  type GenerationLogLevel,
  type GenerationStructuredLogger,
  createGenerationStructuredLogger,
} from "./structured-logger";
import {
  type GenerationSpanAttribute,
  type GenerationTracing,
  enterGenerationSpan,
} from "./tracing";

export interface GenerationObservability {
  event(
    event: string,
    context: GenerationTraceContext,
    fields?: GenerationEventFields,
    level?: GenerationLogLevel,
  ): void;
  span<T>(
    name: string,
    context: GenerationTraceContext,
    attributes: Record<string, GenerationSpanAttribute>,
    callback: () => T,
  ): T;
  modelCall(record: ModelCallAnalyticsRecord): void;
}

export function createGenerationObservability(
  env: Pick<Env, "WIKI_AI_TELEMETRY">,
  tracing?: GenerationTracing,
  dependencies: {
    logger?: GenerationStructuredLogger;
    analyticsWriter?: ModelCallAnalyticsWriter;
  } = {},
): GenerationObservability {
  const logger = dependencies.logger ?? createGenerationStructuredLogger();
  const analytics =
    dependencies.analyticsWriter ?? createAnalyticsEngineModelCallWriter(env.WIKI_AI_TELEMETRY);

  return {
    event(event, context, fields, level) {
      try {
        logger.write(event, context, fields, level);
      } catch {
        // Every sink is treated as untrusted, including injected adapters.
      }
    },
    span(name, context, attributes, callback) {
      return enterGenerationSpan(tracing, name, context, attributes, callback);
    },
    modelCall(record) {
      try {
        analytics.write(record);
      } catch {
        // Analytics must not become part of generation correctness.
      }
      try {
        logger.write(
          record.outcome === "success" ? "model_call_completed" : "model_call_failed",
          record.context,
          {
            modelCallId: record.context.modelCallId,
            phase: record.context.phase,
            program: record.program,
            outcome: record.outcome,
            durationMs: record.latencyMs,
            // Never log prompt, completion, message, or provider payload here.
            data: {
              model: record.model,
              promptVersion: record.promptVersion,
              stage: record.stage,
              finishReason: record.finishReason,
              inputTokens: record.inputTokens,
              outputTokens: record.outputTokens,
              totalTokens: record.totalTokens,
              inputChars: record.inputChars,
              outputChars: record.outputChars,
              toolCount: record.toolCount,
              repairCount: record.repairCount,
            },
          },
          record.outcome === "success" ? "info" : "warn",
        );
      } catch {
        // A broken log adapter must not affect generation either.
      }
    },
  };
}
