import type { IngestionWorkflowPhase } from "./commands";

export type ModelProgram = "clarify" | "plan" | "draft" | "regenerate";

export type ToolName = "ls" | "cat" | "search" | "google_drive" | "google_forms" | "web_fetch";

export interface ToolArgumentsByName {
  ls: { path: string; limit?: number; cursor?: string };
  cat: { path: string; maxChars?: number; cursor?: string };
  search: { query: string; path?: string; limit?: number; cursor?: string };
  google_drive: { url: string };
  google_forms: { url: string; eventTitle?: string };
  web_fetch: { url: string };
}

export type ToolLifecycleEvent = {
  [Name in ToolName]:
    | {
        type: "tool_started";
        toolCallId: string;
        tool: Name;
        args: ToolArgumentsByName[Name];
        summary: string;
      }
    | {
        type: "tool_completed";
        toolCallId: string;
        tool: Name;
        args: ToolArgumentsByName[Name];
        durationMs: number;
        truncated: boolean;
      }
    | {
        type: "tool_failed";
        toolCallId: string;
        tool: Name;
        args: ToolArgumentsByName[Name];
        errorCode: string;
      };
}[ToolName];

export function toolStartedEvent<Name extends ToolName>(
  tool: Name,
  toolCallId: string,
  args: ToolArgumentsByName[Name],
  summary: string,
): ToolLifecycleEvent {
  return { type: "tool_started", toolCallId, tool, args, summary } as ToolLifecycleEvent;
}

export function toolCompletedEvent<Name extends ToolName>(
  tool: Name,
  toolCallId: string,
  args: ToolArgumentsByName[Name],
  durationMs: number,
  truncated: boolean,
): ToolLifecycleEvent {
  return {
    type: "tool_completed",
    toolCallId,
    tool,
    args,
    durationMs,
    truncated,
  } as ToolLifecycleEvent;
}

export function toolFailedEvent<Name extends ToolName>(
  tool: Name,
  toolCallId: string,
  args: ToolArgumentsByName[Name],
  errorCode: string,
): ToolLifecycleEvent {
  return { type: "tool_failed", toolCallId, tool, args, errorCode } as ToolLifecycleEvent;
}

/**
 * Display-safe execution events. Tool outputs, prompts, and source content
 * must never be included in this protocol.
 */
export type IngestionRealtimeEvent =
  | { type: "workflow_started"; workflowId: string; phase: IngestionWorkflowPhase }
  | { type: "model_started"; program: ModelProgram }
  | { type: "model_step"; program: ModelProgram; step: number; limit: number }
  | ToolLifecycleEvent
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

const TOOL_NAMES = new Set<ToolName>([
  "ls",
  "cat",
  "search",
  "google_drive",
  "google_forms",
  "web_fetch",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = [],
): boolean {
  const allowed = new Set([...required, ...optional]);
  return (
    required.every((key) => Object.hasOwn(value, key)) &&
    Object.keys(value).every((key) => allowed.has(key))
  );
}

function optionalString(value: Record<string, unknown>, key: string): boolean {
  return !Object.hasOwn(value, key) || typeof value[key] === "string";
}

function optionalNumber(value: Record<string, unknown>, key: string): boolean {
  return (
    !Object.hasOwn(value, key) || (typeof value[key] === "number" && Number.isFinite(value[key]))
  );
}

function parseToolArguments<Name extends ToolName>(
  tool: Name,
  value: unknown,
): ToolArgumentsByName[Name] | null {
  if (!isRecord(value)) return null;
  switch (tool) {
    case "ls":
      return hasExactKeys(value, ["path"], ["limit", "cursor"]) &&
        typeof value.path === "string" &&
        optionalNumber(value, "limit") &&
        optionalString(value, "cursor")
        ? (value as ToolArgumentsByName[Name])
        : null;
    case "cat":
      return hasExactKeys(value, ["path"], ["maxChars", "cursor"]) &&
        typeof value.path === "string" &&
        optionalNumber(value, "maxChars") &&
        optionalString(value, "cursor")
        ? (value as ToolArgumentsByName[Name])
        : null;
    case "search":
      return hasExactKeys(value, ["query"], ["path", "limit", "cursor"]) &&
        typeof value.query === "string" &&
        optionalString(value, "path") &&
        optionalNumber(value, "limit") &&
        optionalString(value, "cursor")
        ? (value as ToolArgumentsByName[Name])
        : null;
    case "google_drive":
    case "web_fetch":
      return hasExactKeys(value, ["url"]) && typeof value.url === "string"
        ? (value as ToolArgumentsByName[Name])
        : null;
    case "google_forms":
      return hasExactKeys(value, ["url"], ["eventTitle"]) &&
        typeof value.url === "string" &&
        optionalString(value, "eventTitle")
        ? (value as ToolArgumentsByName[Name])
        : null;
  }
}

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
  // messages and prevent unallowlisted fields from entering the activity feed.
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
      if (
        !hasExactKeys(event, ["type", "toolCallId", "tool", "args", "summary"]) ||
        typeof event.toolCallId !== "string" ||
        typeof event.tool !== "string" ||
        !TOOL_NAMES.has(event.tool as ToolName) ||
        typeof event.summary !== "string"
      ) {
        return null;
      }
      return parseToolArguments(event.tool as ToolName, event.args)
        ? (event as IngestionRealtimeEvent)
        : null;
    case "tool_completed":
      if (
        !hasExactKeys(event, ["type", "toolCallId", "tool", "args", "durationMs", "truncated"]) ||
        typeof event.toolCallId !== "string" ||
        typeof event.tool !== "string" ||
        !TOOL_NAMES.has(event.tool as ToolName) ||
        typeof event.durationMs !== "number" ||
        !Number.isFinite(event.durationMs) ||
        typeof event.truncated !== "boolean"
      ) {
        return null;
      }
      return parseToolArguments(event.tool as ToolName, event.args)
        ? (event as IngestionRealtimeEvent)
        : null;
    case "tool_failed":
      if (
        !hasExactKeys(event, ["type", "toolCallId", "tool", "args", "errorCode"]) ||
        typeof event.toolCallId !== "string" ||
        typeof event.tool !== "string" ||
        !TOOL_NAMES.has(event.tool as ToolName) ||
        typeof event.errorCode !== "string"
      ) {
        return null;
      }
      return parseToolArguments(event.tool as ToolName, event.args)
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
