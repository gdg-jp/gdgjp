import { describe, expect, it, vi } from "vitest";
import { createAiGatewayTelemetryHeaders } from "./ai-gateway";
import { createAnalyticsEngineModelCallWriter } from "./analytics-engine";
import { createGenerationObservability } from "./generation-observability";
import {
  createGenerationTraceContext,
  createModelCallTraceContext,
  withGenerationPhase,
} from "./generation-trace-context";
import { sanitizeLogValue, serializeError } from "./safe-json";
import { createGenerationStructuredLogger } from "./structured-logger";
import { type GenerationTracing, enterGenerationSpan } from "./tracing";

const trace = withGenerationPhase(
  createGenerationTraceContext({
    sessionId: "session-1",
    workflowId: "workflow-1",
    runId: "run-1",
  }),
  "plan",
);

describe("generation trace context", () => {
  it("preserves correlation IDs across phase and model call contexts", () => {
    const modelCall = createModelCallTraceContext(trace, "call-1");

    expect(modelCall).toEqual({
      sessionId: "session-1",
      workflowId: "workflow-1",
      runId: "run-1",
      phase: "plan",
      modelCallId: "call-1",
    });
  });
});

describe("AI Gateway correlation headers", () => {
  it("records payloads with exactly five searchable correlation fields", () => {
    const headers = createAiGatewayTelemetryHeaders(
      { AI_GATEWAY_BASE_URL: "https://gateway.example/v1", AI_GATEWAY_TOKEN: "secret" },
      createModelCallTraceContext(trace, "call-1"),
      "plan",
    );

    expect(headers?.["cf-aig-collect-log-payload"]).toBe("true");
    const metadata = JSON.parse(headers?.["cf-aig-metadata"] ?? "{}") as Record<string, unknown>;
    expect(Object.keys(metadata)).toHaveLength(5);
    expect(metadata).toEqual({
      session_id: "session-1",
      workflow_id: "workflow-1",
      run_id: "run-1",
      model_call_id: "call-1",
      program: "plan",
    });
    expect(JSON.stringify(headers)).not.toContain("secret");
  });
});

describe("safe log serialization", () => {
  it("redacts credentials, excludes binary data, bounds text, and preserves error causes", () => {
    const error = new Error("request failed: token=top-secret");
    error.cause = { authorization: "Bearer should-not-appear" };
    const value = sanitizeLogValue(
      {
        apiKey: "should-not-appear",
        attachment: new Uint8Array([1, 2, 3]),
        text: "x".repeat(20),
        error,
      },
      { maxStringLength: 10 },
    );

    expect(value).toMatchObject({
      apiKey: "[REDACTED]",
      attachment: "[binary omitted]",
      text: expect.stringContaining("[truncated 10 chars]"),
      error: {
        message: "request fa… [truncated 22 chars]",
        cause: { authorization: "[REDACTED]" },
      },
    });
    expect(JSON.stringify(value)).not.toContain("top-secret");
    expect(JSON.stringify(serializeError(error))).not.toContain("should-not-appear");
  });

  it("safely serializes cyclic Error causes", () => {
    const error = new Error("cyclic");
    error.cause = error;

    expect(serializeError(error)).toMatchObject({
      message: "cyclic",
      cause: "[circular reference omitted]",
    });
  });

  it("redacts credentials embedded in textual tool results", () => {
    const value = sanitizeLogValue({
      result: '{"apiKey":"json-secret","nested":"Bearer bearer-secret"}',
    });

    expect(JSON.stringify(value)).not.toContain("json-secret");
    expect(JSON.stringify(value)).not.toContain("bearer-secret");
    expect(value).toEqual({
      result: '{"apiKey":"[REDACTED]","nested":"Bearer [REDACTED]"}',
    });
  });

  it("keeps numeric token usage metrics while redacting credential tokens", () => {
    expect(
      sanitizeLogValue({
        inputTokens: 12,
        outputTokens: 8,
        totalTokens: 20,
        accessToken: "credential",
      }),
    ).toEqual({
      inputTokens: 12,
      outputTokens: 8,
      totalTokens: 20,
      accessToken: "[REDACTED]",
    });
  });
});

describe("structured worker logs", () => {
  it("emits the common envelope and does not propagate logger failures", () => {
    const lines: string[] = [];
    const logger = createGenerationStructuredLogger({
      write: (line) => lines.push(line),
      now: () => new Date("2026-07-22T00:00:00.000Z"),
    });
    logger.write("tool_completed", trace, {
      program: "plan",
      operationIndex: 2,
      outcome: "success",
      durationMs: 12,
      data: {
        result: "bounded tool result",
        accessToken: "nope",
        prompt: "model payload must stay in AI Gateway",
      },
    });

    expect(JSON.parse(lines[0])).toEqual({
      schemaVersion: 1,
      event: "tool_completed",
      timestamp: "2026-07-22T00:00:00.000Z",
      level: "info",
      sessionId: "session-1",
      workflowId: "workflow-1",
      runId: "run-1",
      phase: "plan",
      program: "plan",
      operationIndex: 2,
      outcome: "success",
      durationMs: 12,
      data: {
        result: "bounded tool result",
        accessToken: "[REDACTED]",
        prompt: "[model payload omitted]",
      },
    });

    expect(() =>
      createGenerationStructuredLogger({
        write: () => {
          throw new Error("logger offline");
        },
      }).write("workflow_started", trace),
    ).not.toThrow();
  });
});

describe("Cloudflare tracing wrapper", () => {
  it("adds correlation attributes and preserves nested operation results", async () => {
    const setAttribute = vi.fn();
    const tracing: GenerationTracing = {
      enterSpan: (_name, callback) => callback({ isTraced: true, setAttribute }),
    };

    await expect(
      enterGenerationSpan(
        tracing,
        "generation.phase",
        trace,
        { "generation.program": "plan" },
        async () => 42,
      ),
    ).resolves.toBe(42);
    expect(setAttribute).toHaveBeenCalledWith("generation.session_id", "session-1");
    expect(setAttribute).toHaveBeenCalledWith("generation.workflow_id", "workflow-1");
    expect(setAttribute).toHaveBeenCalledWith("generation.run_id", "run-1");
    expect(setAttribute).toHaveBeenCalledWith("generation.program", "plan");
  });

  it("falls back only when tracing itself cannot start a span", () => {
    const tracing: GenerationTracing = {
      enterSpan: () => {
        throw new Error("tracing unavailable");
      },
    };
    expect(enterGenerationSpan(tracing, "generation.phase", trace, {}, () => "completed")).toBe(
      "completed",
    );
    expect(() =>
      enterGenerationSpan(
        { enterSpan: (_name, callback) => callback({ setAttribute: () => undefined }) },
        "generation.phase",
        trace,
        {},
        () => {
          throw new Error("generation failed");
        },
      ),
    ).toThrow("generation failed");
  });
});

describe("Analytics Engine model call writer", () => {
  it("writes one data point with the stable model comparison schema", () => {
    const writeDataPoint = vi.fn();
    const writer = createAnalyticsEngineModelCallWriter({
      writeDataPoint,
    } as AnalyticsEngineDataset);
    writer.write({
      context: createModelCallTraceContext(trace, "call-1"),
      model: "gemini-3.5-flash-lite",
      promptVersion: "2026-07-22",
      program: "plan",
      stage: "structured_output_repair",
      outcome: "success",
      finishReason: "stop",
      latencyMs: 123,
      inputTokens: 10,
      outputTokens: 20,
      totalTokens: 30,
      inputChars: 100,
      outputChars: 200,
      toolCount: 2,
      repairCount: 1,
    });

    expect(writeDataPoint).toHaveBeenCalledWith({
      indexes: ["session-1"],
      blobs: [
        "gemini-3.5-flash-lite",
        "2026-07-22",
        "plan",
        "structured_output_repair",
        "success",
        "stop",
      ],
      doubles: [123, 10, 20, 30, 100, 200, 2, 1],
    });
  });

  it("absorbs Analytics Engine failures and never serializes model payloads in model-call logs", () => {
    const loggerWrite = vi.fn();
    const observability = createGenerationObservability(
      {
        WIKI_AI_TELEMETRY: {
          writeDataPoint: () => {
            throw new Error("analytics unavailable");
          },
        },
      } as Pick<Env, "WIKI_AI_TELEMETRY">,
      undefined,
      { logger: { write: loggerWrite } },
    );

    expect(() =>
      observability.modelCall({
        context: createModelCallTraceContext(trace, "call-1"),
        model: "gemini",
        promptVersion: "v1",
        program: "draft",
        stage: "draft",
        outcome: "success",
        latencyMs: 1,
      }),
    ).not.toThrow();
    expect(loggerWrite.mock.calls[0][2].data).not.toHaveProperty("prompt");
    expect(loggerWrite.mock.calls[0][2].data).not.toHaveProperty("completion");
  });

  it("isolates failures from injected telemetry sinks", () => {
    const observability = createGenerationObservability(
      {} as Pick<Env, "WIKI_AI_TELEMETRY">,
      undefined,
      {
        logger: {
          write: () => {
            throw new Error("log sink unavailable");
          },
        },
        analyticsWriter: {
          write: () => {
            throw new Error("analytics sink unavailable");
          },
        },
      },
    );

    expect(() => observability.event("workflow_started", trace)).not.toThrow();
    expect(() =>
      observability.modelCall({
        context: createModelCallTraceContext(trace, "call-1"),
        model: "gemini",
        promptVersion: "v1",
        program: "plan",
        stage: "structured",
        outcome: "success",
        latencyMs: 1,
      }),
    ).not.toThrow();
  });
});
