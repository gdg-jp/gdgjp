import { describe, expect, it } from "vitest";
import { parseIngestionRealtimeEvent, realtimeEventKey } from "./realtime-events";

describe("ingestion realtime event protocol", () => {
  it("accepts display-safe tool lifecycle events and keys each delivery kind", () => {
    const args = { query: "community event", path: "/wiki", limit: 5 };
    const started = parseIngestionRealtimeEvent({
      type: "tool_started",
      toolCallId: "call-1",
      tool: "search",
      args,
      summary: "Searching page titles",
    });
    const completed = parseIngestionRealtimeEvent({
      type: "tool_completed",
      toolCallId: "call-1",
      tool: "search",
      args,
      durationMs: 120,
      truncated: false,
    });

    expect(started).not.toBeNull();
    expect(completed).not.toBeNull();
    if (!started || !completed) throw new Error("Expected parsed realtime events");
    expect(realtimeEventKey(started)).toBe("tool_started:call-1");
    expect(realtimeEventKey(completed)).toBe("tool_completed:call-1");
  });

  it.each([
    ["ls", { path: "/", limit: 10, cursor: "next-ls" }],
    ["cat", { path: "/wiki/page", maxChars: 500, cursor: "next-cat" }],
    ["search", { query: "chapter", path: "/wiki", limit: 3, cursor: "next-search" }],
    ["google_drive", { url: "https://docs.google.test/document/d/1" }],
    ["google_forms", { url: "https://docs.google.test/forms/d/1", eventTitle: "DevFest" }],
    ["web_fetch", { url: "https://example.test/source?full=value#section" }],
  ])("accepts the allowlisted arguments for %s", (tool, args) => {
    expect(
      parseIngestionRealtimeEvent({
        type: "tool_started",
        toolCallId: `call-${tool}`,
        tool,
        args,
        summary: "Calling tool",
      }),
    ).not.toBeNull();
  });

  it("drops malformed and Agent protocol messages before they reach the UI", () => {
    expect(parseIngestionRealtimeEvent({ type: "CF_AGENT_STATE", state: {} })).toBeNull();
    expect(parseIngestionRealtimeEvent({ type: "tool_started", toolCallId: "call-1" })).toBeNull();
    expect(
      parseIngestionRealtimeEvent({
        type: "tool_started",
        toolCallId: "call-2",
        tool: "cat",
        args: { path: "/wiki/page", query: "wrong tool argument" },
        summary: "Reading",
      }),
    ).toBeNull();
    expect(
      parseIngestionRealtimeEvent({
        type: "tool_failed",
        toolCallId: "call-3",
        tool: "web_fetch",
        args: { url: "https://example.test", content: "must not cross the protocol" },
        errorCode: "fetch_failed",
      }),
    ).toBeNull();
    expect(
      parseIngestionRealtimeEvent({
        type: "tool_completed",
        toolCallId: "call-4",
        tool: "google_drive",
        args: { url: "https://docs.google.test/document/d/1" },
        durationMs: 10,
        truncated: false,
        accessToken: "must not cross the protocol",
      }),
    ).toBeNull();
  });
});
