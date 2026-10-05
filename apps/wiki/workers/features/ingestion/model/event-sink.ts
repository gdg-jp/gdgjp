/** Compatibility import point for model code. The orchestration port owns the
 * abstraction so workflows can supply the Agents SDK adapter without leaking
 * the SDK into this layer. */
export {
  createCollectingEventSink,
  noopExecutionEventSink as NOOP_EXECUTION_EVENT_SINK,
} from "../orchestration/ports/tool-event-sink";
export type { ExecutionEventSink } from "../orchestration/ports/tool-event-sink";
export type {
  IngestionRealtimeEvent,
  ModelProgram,
  ToolName,
} from "../../../../shared/ingestion/realtime-events";
