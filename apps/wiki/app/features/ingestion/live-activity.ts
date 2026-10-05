import type {
  IngestionRealtimeEvent,
  ToolArgumentsByName,
  ToolLifecycleEvent,
  ToolName,
} from "../../../shared/ingestion/realtime-events";

export interface ToolActivityItem {
  kind: "tool";
  key: string;
  toolCallId: string;
  tool: ToolName;
  args: ToolArgumentsByName[ToolName];
  status: "running" | "completed" | "failed";
  summary?: string;
  durationMs?: number;
  truncated?: boolean;
  errorCode?: string;
}

export type LiveActivityItem =
  | ToolActivityItem
  | { kind: "event"; key: string; event: Exclude<IngestionRealtimeEvent, ToolLifecycleEvent> };

function isToolLifecycleEvent(event: IngestionRealtimeEvent): event is ToolLifecycleEvent {
  return (
    event.type === "tool_started" || event.type === "tool_completed" || event.type === "tool_failed"
  );
}

function createToolActivity(event: ToolLifecycleEvent): ToolActivityItem {
  const common = {
    kind: "tool" as const,
    key: `tool:${event.toolCallId}`,
    toolCallId: event.toolCallId,
    tool: event.tool,
    args: event.args,
  };
  switch (event.type) {
    case "tool_started":
      return { ...common, status: "running", summary: event.summary };
    case "tool_completed":
      return {
        ...common,
        status: "completed",
        durationMs: event.durationMs,
        truncated: event.truncated,
      };
    case "tool_failed":
      return { ...common, status: "failed", errorCode: event.errorCode };
  }
}

function updateToolActivity(
  current: ToolActivityItem,
  event: ToolLifecycleEvent,
): ToolActivityItem {
  const next = createToolActivity(event);
  return {
    ...current,
    ...next,
    summary: next.summary ?? current.summary,
  };
}

/** Combines tool lifecycle events while preserving the activity feed's first-seen ordering. */
export function buildLiveActivity(
  events: readonly IngestionRealtimeEvent[],
  limit = 5,
): LiveActivityItem[] {
  const items: LiveActivityItem[] = [];
  const toolIndexes = new Map<string, number>();

  for (const [index, event] of events.entries()) {
    if (!isToolLifecycleEvent(event)) {
      items.push({ kind: "event", key: `${event.type}:${index}`, event });
      continue;
    }

    const existingIndex = toolIndexes.get(event.toolCallId);
    if (existingIndex === undefined) {
      toolIndexes.set(event.toolCallId, items.length);
      items.push(createToolActivity(event));
      continue;
    }

    const existing = items[existingIndex];
    if (existing.kind === "tool") items[existingIndex] = updateToolActivity(existing, event);
  }

  return items.slice(-limit);
}

export function formatToolArguments(args: ToolArgumentsByName[ToolName]): string {
  return JSON.stringify(args, null, 2);
}
