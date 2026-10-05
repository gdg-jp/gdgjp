import type { ModelCallTraceContext } from "./generation-trace-context";

export type ModelCallAnalyticsRecord = {
  context: ModelCallTraceContext;
  model: string;
  promptVersion: string;
  program: string;
  stage: string;
  outcome: string;
  finishReason?: string;
  latencyMs: number;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  inputChars?: number;
  outputChars?: number;
  toolCount?: number;
  repairCount?: number;
};

export interface ModelCallAnalyticsWriter {
  write(record: ModelCallAnalyticsRecord): void;
}

const numberOrZero = (value: number | undefined): number =>
  typeof value === "number" && Number.isFinite(value) ? value : 0;

/**
 * WAE schema (keep this positional contract stable for operational SQL):
 * indexes[0]=sessionId;
 * blobs=model,promptVersion,program,stage,outcome,finishReason;
 * doubles=latencyMs,inputTokens,outputTokens,totalTokens,inputChars,outputChars,toolCount,repairCount.
 */
export function createAnalyticsEngineModelCallWriter(
  dataset: AnalyticsEngineDataset | undefined,
): ModelCallAnalyticsWriter {
  return {
    write(record) {
      try {
        dataset?.writeDataPoint({
          indexes: [record.context.sessionId],
          blobs: [
            record.model,
            record.promptVersion,
            record.program,
            record.stage,
            record.outcome,
            record.finishReason ?? null,
          ],
          doubles: [
            numberOrZero(record.latencyMs),
            numberOrZero(record.inputTokens),
            numberOrZero(record.outputTokens),
            numberOrZero(record.totalTokens),
            numberOrZero(record.inputChars),
            numberOrZero(record.outputChars),
            numberOrZero(record.toolCount),
            numberOrZero(record.repairCount),
          ],
        });
      } catch {
        // Analytics is best-effort and must never fail a generation run.
      }
    },
  };
}
