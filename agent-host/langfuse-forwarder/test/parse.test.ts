import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseSessionEvents } from "../src/parse.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = join(__dirname, "..", "fixtures", "sample-events.jsonl");

function readFixtureLines(): string[] {
  return readFileSync(FIXTURE_PATH, "utf-8")
    .split("\n")
    .filter((line) => line.trim().length > 0);
}

describe("parseSessionEvents (fixture-based)", () => {
  it("produces one forwardable turn per matched turn_start/turn_end pair", () => {
    const { turns } = parseSessionEvents("fixture-session", readFixtureLines());
    const turnIds = turns.map((t) => t.turnId).sort();
    expect(turnIds).toEqual(["turn-aaa111", "turn-bbb222"]);
  });

  it("extracts trace/session id correctly and preserves backend/model/prompt", () => {
    const { turns } = parseSessionEvents("fixture-session", readFixtureLines());
    const turn = turns.find((t) => t.turnId === "turn-aaa111");
    expect(turn).toBeDefined();
    expect(turn?.appSessionId).toBe("fixture-session");
    expect(turn?.backend).toBe("cursor");
    expect(turn?.model).toBe("auto");
    expect(turn?.prompt).toBe("Summarize the venue-cost policy.");
    expect(turn?.outcome).toBe("complete");
    expect(turn?.output).toContain("venue-cost policy");
  });

  it("does not drop any tool_call_start events — both calls survive as siblings", () => {
    const { turns } = parseSessionEvents("fixture-session", readFixtureLines());
    const turn = turns.find((t) => t.turnId === "turn-aaa111");
    expect(turn?.toolCalls).toHaveLength(2);
    expect(turn?.toolCalls.map((c) => c.name)).toEqual(["wk_search", "wk_cat"]);
    expect(turn?.toolCalls.map((c) => c.toolCallId)).toEqual(["call-1", "call-2"]);
  });

  it("records an error outcome with its error message and latency", () => {
    const { turns } = parseSessionEvents("fixture-session", readFixtureLines());
    const turn = turns.find((t) => t.turnId === "turn-bbb222");
    expect(turn?.outcome).toBe("error");
    expect(turn?.error).toBe("Request timed out after 60000ms");
    expect(turn?.latencyMs).toBe(60000);
    expect(turn?.output).toBeUndefined();
  });

  it("treats a turn with only turn_start as pending, not forwardable", () => {
    const { turns, pending } = parseSessionEvents("fixture-session", readFixtureLines());
    expect(turns.some((t) => t.turnId === "turn-ccc333")).toBe(false);
    expect(pending.map((p) => p.turnId)).toContain("turn-ccc333");
  });

  it("quarantines an injected malformed/unknown-version line instead of silently dropping it", () => {
    const { quarantined } = parseSessionEvents("fixture-session", readFixtureLines());
    const reasons = quarantined.map((q) => q.reason).join(" | ");

    // invalid JSON line ("this is not json at all")
    expect(quarantined.some((q) => q.reason.includes("invalid JSON"))).toBe(true);
    // unsupported schemaVersion is quarantined (v1 and v2 remain compatible)
    expect(quarantined.some((q) => q.reason.includes("unsupported schemaVersion"))).toBe(true);
    // malformed turn_end missing outcome/latencyMs
    expect(quarantined.some((q) => q.reason.includes("turn_end"))).toBe(true);
    expect(reasons.length).toBeGreaterThan(0);
  });

  it("a quarantined turn_start never produces a forwardable or pending turn for that turnId", () => {
    const { turns, pending } = parseSessionEvents("fixture-session", readFixtureLines());
    const allTurnIds = [...turns.map((t) => t.turnId), ...pending.map((p) => p.turnId)];
    expect(allTurnIds).not.toContain("turn-future-schema");
  });

  it("is deterministic — parsing the same input twice yields identical results", () => {
    const lines = readFixtureLines();
    const first = parseSessionEvents("fixture-session", lines);
    const second = parseSessionEvents("fixture-session", lines);
    expect(first).toEqual(second);
  });
});

describe("parseSessionEvents (unit-level edge cases)", () => {
  it("quarantines a turn_start event whose appSessionId does not match the file it was read from", () => {
    const line = JSON.stringify({
      schemaVersion: 1,
      type: "turn_start",
      turnId: "t1",
      appSessionId: "other-session",
      createdAt: "2026-01-01T00:00:00.000Z",
      backend: "cursor",
      prompt: "hi",
    });
    const { turns, pending, quarantined } = parseSessionEvents("this-session", [line]);
    expect(turns).toHaveLength(0);
    expect(pending).toHaveLength(0);
    expect(quarantined).toHaveLength(1);
  });

  it("returns empty results for an empty session", () => {
    const result = parseSessionEvents("empty-session", []);
    expect(result).toEqual({ turns: [], pending: [], quarantined: [] });
  });

  it('accepts a "cancelled" turn_end outcome', () => {
    const lines = [
      JSON.stringify({
        schemaVersion: 1,
        type: "turn_start",
        turnId: "t1",
        createdAt: "2026-01-01T00:00:00.000Z",
        backend: "cursor",
        prompt: "hi",
      }),
      JSON.stringify({
        schemaVersion: 1,
        type: "turn_end",
        turnId: "t1",
        createdAt: "2026-01-01T00:00:01.000Z",
        outcome: "cancelled",
        error: "Request cancelled by user",
        latencyMs: 500,
      }),
    ];
    const { turns } = parseSessionEvents("s", lines);
    expect(turns).toHaveLength(1);
    expect(turns[0]).toMatchObject({
      outcome: "cancelled",
      error: "Request cancelled by user",
    });
  });

  it("preserves v2 completion, partial-model events, and turn-level usage", () => {
    const lines = [
      JSON.stringify({
        schemaVersion: 2,
        type: "turn_start",
        eventId: "1",
        sequence: 1,
        source: "xangi",
        turnId: "t1",
        createdAt: "2026-01-01T00:00:00.000Z",
        backend: "cursor",
        prompt: "hi",
      }),
      JSON.stringify({
        schemaVersion: 2,
        type: "tool_call_start",
        eventId: "2",
        sequence: 2,
        source: "cursor",
        turnId: "t1",
        createdAt: "2026-01-01T00:00:01.000Z",
        toolCallId: "call",
        name: "Read",
        input: { path: "a" },
        modelCallId: "model-1",
      }),
      JSON.stringify({
        schemaVersion: 2,
        type: "tool_call_end",
        eventId: "3",
        sequence: 3,
        source: "cursor",
        turnId: "t1",
        createdAt: "2026-01-01T00:00:02.000Z",
        toolCallId: "call",
        output: "contents",
      }),
      JSON.stringify({
        schemaVersion: 2,
        type: "cursor_event",
        eventId: "4",
        sequence: 4,
        source: "cursor",
        turnId: "t1",
        createdAt: "2026-01-01T00:00:03.000Z",
        name: "assistant_message",
        modelCallId: "model-1",
        payload: { text: "answer" },
      }),
      JSON.stringify({
        schemaVersion: 2,
        type: "cursor_event",
        eventId: "5",
        sequence: 5,
        source: "cursor",
        turnId: "t1",
        createdAt: "2026-01-01T00:00:04.000Z",
        name: "result",
        payload: { usage: { inputTokens: 3, outputTokens: 5 } },
      }),
      JSON.stringify({
        schemaVersion: 2,
        type: "turn_end",
        eventId: "6",
        sequence: 6,
        source: "xangi",
        turnId: "t1",
        createdAt: "2026-01-01T00:00:05.000Z",
        outcome: "complete",
        latencyMs: 5,
      }),
    ];
    const { turns } = parseSessionEvents("s", lines);
    expect(turns[0]).toMatchObject({ usage: { input: 3, output: 5 } });
    expect(turns[0].cursorEvents).toEqual(
      expect.arrayContaining([expect.objectContaining({ modelCallId: "model-1" })]),
    );
    expect(turns[0].toolCalls[0]).toMatchObject({
      completedAt: "2026-01-01T00:00:02.000Z",
      output: "contents",
    });
  });

  it("an unknown event type for one turnId does not drop an unrelated, already-complete turn", () => {
    // Repro for a real bug: turnOrder.pop() removed whichever turnId was
    // pushed LAST, not the turnId the unknown event actually belonged to.
    // t1 starts, then t2 starts, then an unknown event arrives for t1 (not
    // t2) — t2's already-valid turn_start+turn_end must still come out.
    const lines = [
      JSON.stringify({
        schemaVersion: 1,
        type: "turn_start",
        turnId: "t1",
        createdAt: "2026-01-01T00:00:00.000Z",
        backend: "cursor",
        prompt: "first",
      }),
      JSON.stringify({
        schemaVersion: 1,
        type: "turn_start",
        turnId: "t2",
        createdAt: "2026-01-01T00:00:01.000Z",
        backend: "cursor",
        prompt: "second",
      }),
      JSON.stringify({
        schemaVersion: 1,
        type: "some_future_event_type",
        turnId: "t1",
        createdAt: "2026-01-01T00:00:02.000Z",
      }),
      JSON.stringify({
        schemaVersion: 1,
        type: "turn_end",
        turnId: "t2",
        createdAt: "2026-01-01T00:00:03.000Z",
        outcome: "complete",
        output: "done",
        latencyMs: 1000,
      }),
    ];
    const { turns, pending, quarantined } = parseSessionEvents("s", lines);

    expect(quarantined.some((q) => q.reason.includes("unknown event type"))).toBe(true);

    // t1 is correctly discarded (its unknown event makes it unforwardable)...
    expect(turns.some((t) => t.turnId === "t1")).toBe(false);
    expect(pending.some((p) => p.turnId === "t1")).toBe(false);

    // ...but t2 must survive intact — this is exactly what the old pop()-based
    // code silently destroyed.
    expect(turns).toHaveLength(1);
    expect(turns[0]).toMatchObject({
      turnId: "t2",
      outcome: "complete",
      output: "done",
    });
  });

  it("quarantines any later event for a turnId that was already discarded, without resurrecting it", () => {
    const lines = [
      JSON.stringify({
        schemaVersion: 1,
        type: "turn_start",
        turnId: "t1",
        createdAt: "2026-01-01T00:00:00.000Z",
        backend: "cursor",
        prompt: "first",
      }),
      JSON.stringify({
        schemaVersion: 1,
        type: "some_future_event_type",
        turnId: "t1",
        createdAt: "2026-01-01T00:00:01.000Z",
      }),
      // A turn_end for t1 arrives AFTER the discard — must not resurrect t1.
      JSON.stringify({
        schemaVersion: 1,
        type: "turn_end",
        turnId: "t1",
        createdAt: "2026-01-01T00:00:02.000Z",
        outcome: "complete",
        output: "should not count",
        latencyMs: 1000,
      }),
    ];
    const { turns, pending } = parseSessionEvents("s", lines);
    expect(turns.some((t) => t.turnId === "t1")).toBe(false);
    expect(pending.some((p) => p.turnId === "t1")).toBe(false);
  });
});
