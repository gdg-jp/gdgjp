import type { IngestionWorkflowPhase } from "./commands";

export type ModelProgram = "clarify" | "plan" | "draft" | "regenerate";

export type ToolName =
  | "pwd"
  | "cd"
  | "ls"
  | "cat"
  | "find"
  | "grep"
  | "google_drive"
  | "google_forms"
  | "web_fetch";

/**
 * Display-safe execution events. Tool outputs, prompts, and source content
 * must never be included in this protocol.
 */
export type IngestionRealtimeEvent =
  | { type: "workflow_started"; workflowId: string; phase: IngestionWorkflowPhase }
  | { type: "model_started"; program: ModelProgram }
  | { type: "model_step"; program: ModelProgram; step: number; limit: number }
  | { type: "tool_started"; toolCallId: string; tool: ToolName; summary: string }
  | {
      type: "tool_completed";
      toolCallId: string;
      tool: ToolName;
      durationMs: number;
      truncated: boolean;
    }
  | { type: "tool_failed"; toolCallId: string; tool: ToolName; errorCode: string }
  | { type: "operation_started"; index: number; total: number; operationType: string }
  | { type: "operation_completed"; index: number; total: number }
  | { type: "awaiting_input"; input: "url_selection" | "clarification" }
  | { type: "completed" }
  | { type: "failed"; errorCode: string };

const EVENT_TYPES = new Set<IngestionRealtimeEvent["type"]>([
  "workflow_started",
  "model_started",
  "model_step",
  "tool_started",
  "tool_completed",
  "tool_failed",
  "operation_started",
  "operation_completed",
  "awaiting_input",
  "completed",
  "failed",
]);

/** Returns only a recognized event; protocol and malformed WS messages are ignored. */
export function parseIngestionRealtimeEvent(value: unknown): IngestionRealtimeEvent | null {
  if (!value || typeof value !== "object") return null;
  const event = value as Record<string, unknown>;
  if (
    typeof event.type !== "string" ||
    !EVENT_TYPES.has(event.type as IngestionRealtimeEvent["type"])
  ) {
    return null;
  }

  // The server owns validation. These checks protect the UI from malformed
  // messages during rollout without copying potentially sensitive data.
  switch (event.type) {
    case "workflow_started":
      return typeof event.workflowId === "string" && typeof event.phase === "string"
        ? (event as IngestionRealtimeEvent)
        : null;
    case "model_started":
      return typeof event.program === "string" ? (event as IngestionRealtimeEvent) : null;
    case "model_step":
      return typeof event.program === "string" &&
        typeof event.step === "number" &&
        typeof event.limit === "number"
        ? (event as IngestionRealtimeEvent)
        : null;
    case "tool_started":
      return typeof event.toolCallId === "string" &&
        typeof event.tool === "string" &&
        typeof event.summary === "string"
        ? (event as IngestionRealtimeEvent)
        : null;
    case "tool_completed":
      return typeof event.toolCallId === "string" &&
        typeof event.tool === "string" &&
        typeof event.durationMs === "number" &&
        typeof event.truncated === "boolean"
        ? (event as IngestionRealtimeEvent)
        : null;
    case "tool_failed":
      return typeof event.toolCallId === "string" &&
        typeof event.tool === "string" &&
        typeof event.errorCode === "string"
        ? (event as IngestionRealtimeEvent)
        : null;
    case "operation_started":
      return typeof event.index === "number" &&
        typeof event.total === "number" &&
        typeof event.operationType === "string"
        ? (event as IngestionRealtimeEvent)
        : null;
    case "operation_completed":
      return typeof event.index === "number" && typeof event.total === "number"
        ? (event as IngestionRealtimeEvent)
        : null;
    case "awaiting_input":
      return event.input === "url_selection" || event.input === "clarification"
        ? (event as IngestionRealtimeEvent)
        : null;
    case "completed":
      return { type: "completed" };
    case "failed":
      return typeof event.errorCode === "string" ? (event as IngestionRealtimeEvent) : null;
    default:
      return null;
  }
}

/** Re-delivery is expected; started/completed/failed remain distinct lifecycle events. */
export function realtimeEventKey(event: IngestionRealtimeEvent): string | null {
  switch (event.type) {
    case "tool_started":
    case "tool_completed":
    case "tool_failed":
      return `${event.type}:${event.toolCallId}`;
    default:
      return null;
  }
}
