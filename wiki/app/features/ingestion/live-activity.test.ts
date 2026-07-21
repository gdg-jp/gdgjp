import { describe, expect, it } from "vitest";
import type { IngestionRealtimeEvent } from "../../../shared/ingestion/realtime-events";
import { buildLiveActivity, formatToolArguments } from "./live-activity";

describe("buildLiveActivity", () => {
  it("combines a tool lifecycle into one completed activity card", () => {
    const args = { query: "DevFest Japan", path: "/wiki", limit: 5 };
    const events: IngestionRealtimeEvent[] = [
      {
        type: "tool_started",
        toolCallId: "call-1",
        tool: "search",
        args,
        summary: "Searching workspace resources",
      },
      {
        type: "tool_completed",
        toolCallId: "call-1",
        tool: "search",
        args,
        durationMs: 42,
        truncated: true,
      },
    ];

    expect(buildLiveActivity(events)).toEqual([
      {
        kind: "tool",
        key: "tool:call-1",
        toolCallId: "call-1",
        tool: "search",
        args,
        status: "completed",
        summary: "Searching workspace resources",
        durationMs: 42,
        truncated: true,
      },
    ]);
  });

  it("can render a self-contained failure received after the client connects", () => {
    const args = { url: "https://example.test/source?full=value#section" };
    const events: IngestionRealtimeEvent[] = [
      {
        type: "tool_failed",
        toolCallId: "call-2",
        tool: "web_fetch",
        args,
        errorCode: "source_tool_failed",
      },
    ];

    expect(buildLiveActivity(events)).toEqual([
      expect.objectContaining({
        kind: "tool",
        tool: "web_fetch",
        args,
        status: "failed",
        errorCode: "source_tool_failed",
      }),
    ]);
    expect(formatToolArguments(args)).toContain("https://example.test/source?full=value#section");
  });

  it("keeps non-tool activity and limits the combined feed", () => {
    const events: IngestionRealtimeEvent[] = Array.from({ length: 7 }, (_, index) => ({
      type: "model_step" as const,
      program: "draft" as const,
      step: index + 1,
      limit: 7,
    }));

    const activity = buildLiveActivity(events, 5);
    expect(activity).toHaveLength(5);
    expect(activity[0]).toEqual(expect.objectContaining({ kind: "event", key: "model_step:2" }));
  });
});
