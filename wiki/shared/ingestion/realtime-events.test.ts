import { describe, expect, it } from "vitest";
import { parseIngestionRealtimeEvent, realtimeEventKey } from "./realtime-events";

describe("ingestion realtime event protocol", () => {
  it("accepts display-safe tool lifecycle events and keys each delivery kind", () => {
    const started = parseIngestionRealtimeEvent({
      type: "tool_started",
      toolCallId: "call-1",
      tool: "search",
      summary: "Searching page titles",
    });
    const completed = parseIngestionRealtimeEvent({
      type: "tool_completed",
      toolCallId: "call-1",
      tool: "search",
      durationMs: 120,
      truncated: false,
    });

    expect(started).not.toBeNull();
    expect(completed).not.toBeNull();
    if (!started || !completed) throw new Error("Expected parsed realtime events");
    expect(realtimeEventKey(started)).toBe("tool_started:call-1");
    expect(realtimeEventKey(completed)).toBe("tool_completed:call-1");
  });

  it("drops malformed and Agent protocol messages before they reach the UI", () => {
    expect(parseIngestionRealtimeEvent({ type: "CF_AGENT_STATE", state: {} })).toBeNull();
    expect(parseIngestionRealtimeEvent({ type: "tool_started", toolCallId: "call-1" })).toBeNull();
  });
});
