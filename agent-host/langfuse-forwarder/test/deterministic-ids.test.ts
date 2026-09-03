import { describe, expect, it } from "vitest";
import { deterministicIdGenerator, withDeterministicIds } from "../src/deterministic-ids.js";

describe("deterministicIdGenerator / withDeterministicIds", () => {
  it("generates the same trace id for the same seed, on separate calls", () => {
    const first = withDeterministicIds("turn-abc", () =>
      deterministicIdGenerator.generateTraceId(),
    );
    const second = withDeterministicIds("turn-abc", () =>
      deterministicIdGenerator.generateTraceId(),
    );
    expect(first).toBe(second);
  });

  it("generates the same span id for the same seed, on separate calls", () => {
    const first = withDeterministicIds("turn-abc:call-1", () =>
      deterministicIdGenerator.generateSpanId(),
    );
    const second = withDeterministicIds("turn-abc:call-1", () =>
      deterministicIdGenerator.generateSpanId(),
    );
    expect(first).toBe(second);
  });

  it("generates different ids for different seeds", () => {
    const a = withDeterministicIds("turn-a", () => deterministicIdGenerator.generateTraceId());
    const b = withDeterministicIds("turn-b", () => deterministicIdGenerator.generateTraceId());
    expect(a).not.toBe(b);
  });

  it("trace id and span id for the same seed are not identical to each other", () => {
    const traceId = withDeterministicIds("turn-x", () =>
      deterministicIdGenerator.generateTraceId(),
    );
    const spanId = withDeterministicIds("turn-x", () => deterministicIdGenerator.generateSpanId());
    expect(traceId).not.toBe(spanId);
  });

  it("produces W3C-shaped ids: 32 lowercase hex chars for trace id, 16 for span id", () => {
    const traceId = withDeterministicIds("turn-y", () =>
      deterministicIdGenerator.generateTraceId(),
    );
    const spanId = withDeterministicIds("turn-y", () => deterministicIdGenerator.generateSpanId());
    expect(traceId).toMatch(/^[0-9a-f]{32}$/);
    expect(spanId).toMatch(/^[0-9a-f]{16}$/);
  });

  it("a tool call seed (turnId:toolCallId) differs from its parent turn seed", () => {
    const rootSpanId = withDeterministicIds("turn-z", () =>
      deterministicIdGenerator.generateSpanId(),
    );
    const toolSpanId = withDeterministicIds("turn-z:call-1", () =>
      deterministicIdGenerator.generateSpanId(),
    );
    expect(rootSpanId).not.toBe(toolSpanId);
  });

  it("falls back to a random id outside any withDeterministicIds scope, and never collides", () => {
    const a = deterministicIdGenerator.generateTraceId();
    const b = deterministicIdGenerator.generateTraceId();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[0-9a-f]{32}$/);
  });
});
