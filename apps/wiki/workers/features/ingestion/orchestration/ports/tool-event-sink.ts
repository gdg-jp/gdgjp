import type { IngestionRealtimeEvent } from "../../../../../shared/ingestion/realtime-events";

/** Ephemeral execution telemetry. Implementations must not throw into model execution. */
export interface ExecutionEventSink {
  emit(event: IngestionRealtimeEvent): void | Promise<void>;
}

export const noopExecutionEventSink: ExecutionEventSink = {
  emit: () => undefined,
};

export function createCollectingEventSink(events: IngestionRealtimeEvent[]): ExecutionEventSink {
  return {
    emit: (event) => {
      events.push(event);
    },
  };
}
