import type { GenerationTraceContext } from "./generation-trace-context";
import { type SafeJsonValue, sanitizeLogValue } from "./safe-json";

const MODEL_PAYLOAD_KEY =
  /^(?:prompt|completion|messages|system|model[_-]?input|model[_-]?output|provider[_-]?payload)$/i;

export type GenerationLogLevel = "debug" | "info" | "warn" | "error";

export type GenerationLogEvent = {
  schemaVersion: 1;
  event: string;
  timestamp: string;
  level: GenerationLogLevel;
  sessionId: string;
  workflowId: string;
  runId: string;
  modelCallId?: string;
  phase?: string;
  program?: string;
  operationIndex?: number;
  outcome?: string;
  durationMs?: number;
  data?: SafeJsonValue;
};

export type GenerationEventFields = {
  modelCallId?: string;
  phase?: string;
  program?: string;
  operationIndex?: number;
  outcome?: string;
  durationMs?: number;
  /** Never use this for model prompts or completions; AI Gateway is their system of record. */
  data?: Record<string, unknown>;
};

export interface GenerationStructuredLogger {
  write(
    event: string,
    context: GenerationTraceContext,
    fields?: GenerationEventFields,
    level?: GenerationLogLevel,
  ): void;
}

export function createGenerationStructuredLogger(
  options: {
    write?: (line: string) => void;
    now?: () => Date;
  } = {},
): GenerationStructuredLogger {
  const write = options.write ?? ((line: string) => console.log(line));
  const now = options.now ?? (() => new Date());

  return {
    write(event, context, fields = {}, level = "info") {
      // Logging must never turn an otherwise valid generation into a failure.
      try {
        const phase = fields.phase ?? context.phase;
        const payload: GenerationLogEvent = {
          schemaVersion: 1,
          event,
          timestamp: now().toISOString(),
          level,
          sessionId: context.sessionId,
          workflowId: context.workflowId,
          runId: context.runId,
          ...(fields.modelCallId === undefined ? {} : { modelCallId: fields.modelCallId }),
          ...(phase === undefined ? {} : { phase }),
          ...(fields.program === undefined ? {} : { program: fields.program }),
          ...(fields.operationIndex === undefined ? {} : { operationIndex: fields.operationIndex }),
          ...(fields.outcome === undefined ? {} : { outcome: fields.outcome }),
          ...(fields.durationMs === undefined ? {} : { durationMs: fields.durationMs }),
          ...(fields.data === undefined
            ? {}
            : { data: sanitizeLogValue(fields.data, { omitKeys: MODEL_PAYLOAD_KEY }) }),
        };
        write(JSON.stringify(payload));
      } catch {
        // Console/telemetry failures are deliberately isolated from generation.
      }
    },
  };
}
