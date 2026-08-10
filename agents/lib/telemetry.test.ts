import { afterEach, describe, expect, it, vi } from "vitest";

import { getLangfuseSpanProcessor, maskTelemetryData } from "./langfuse";
import {
  agentTelemetry,
  flushTelemetry,
  isTelemetryEnabled,
  observeInquiry,
  pseudonymize,
  resetLangfuseClientForTests,
} from "./telemetry";

afterEach(() => {
  process.env.LANGFUSE_PUBLIC_KEY = "";
  process.env.LANGFUSE_SECRET_KEY = "";
  process.env.TELEMETRY_ID_SALT = "";
  process.env.GOOGLE_VERTEX_API_KEY = "";
  process.env.IDP_CLIENT_SECRET = "";
  process.env.RP_SESSION_SECRET = "";
  process.env.TOKEN_ENCRYPTION_KEYS = "";
  resetLangfuseClientForTests();
});

describe("pseudonymize", () => {
  it("is stable for the same input and salt", () => {
    const a = pseudonymize("discord:user-1", "salt-a");
    const b = pseudonymize("discord:user-1", "salt-a");
    expect(a).toBe(b);
    expect(a).not.toBe("discord:user-1");
    expect(a).toHaveLength(22);
  });

  it("differs across salts", () => {
    expect(pseudonymize("user-1", "salt-a")).not.toBe(pseudonymize("user-1", "salt-b"));
  });

  it("returns anon without a salt (never the raw id)", () => {
    expect(pseudonymize("raw-discord-id", undefined)).toBe("anon");
    expect(pseudonymize("raw-discord-id", "")).toBe("anon");
    expect(pseudonymize("raw-discord-id", "   ")).toBe("anon");
  });
});

describe("isTelemetryEnabled", () => {
  it("is false when either key is missing", () => {
    expect(isTelemetryEnabled({})).toBe(false);
    expect(isTelemetryEnabled({ LANGFUSE_PUBLIC_KEY: "pk" })).toBe(false);
    expect(isTelemetryEnabled({ LANGFUSE_SECRET_KEY: "sk" })).toBe(false);
    expect(isTelemetryEnabled({ LANGFUSE_PUBLIC_KEY: "  ", LANGFUSE_SECRET_KEY: "sk" })).toBe(
      false,
    );
  });

  it("is true when both keys are set", () => {
    expect(isTelemetryEnabled({ LANGFUSE_PUBLIC_KEY: "pk", LANGFUSE_SECRET_KEY: "sk" })).toBe(true);
  });
});

describe("agentTelemetry", () => {
  it("disables recording when keys are absent", () => {
    expect(agentTelemetry("wiki-agent").isEnabled).toBe(false);
  });

  it("enables recording when keys are present", () => {
    process.env.LANGFUSE_PUBLIC_KEY = "pk";
    process.env.LANGFUSE_SECRET_KEY = "sk";
    const settings = agentTelemetry("wiki-agent", { model: "gemini-2.5-flash" });
    expect(settings.isEnabled).toBe(true);
    expect(settings.functionId).toBe("wiki-agent");
    expect(settings.recordInputs).toBe(true);
    expect(settings.recordOutputs).toBe(true);
    expect(settings.metadata).toEqual({ model: "gemini-2.5-flash" });
  });
});

describe("maskTelemetryData", () => {
  it("redacts Bearer tokens, JWTs, and configured env secrets", () => {
    process.env.GOOGLE_VERTEX_API_KEY = "vertex-secret-key";
    process.env.IDP_CLIENT_SECRET = "idp-secret";

    const masked = maskTelemetryData({
      data: {
        note: "Authorization: Bearer super-secret-token",
        jwt: "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.signature",
        nested: ["vertex-secret-key", "plain text"],
      },
    }) as {
      note: string;
      jwt: string;
      nested: string[];
    };

    expect(masked.note).toBe("Authorization: Bearer [REDACTED]");
    expect(masked.jwt).toBe("[REDACTED]");
    expect(masked.nested).toEqual(["[REDACTED]", "plain text"]);
  });

  it("leaves ordinary text unchanged", () => {
    expect(maskTelemetryData({ data: "hello from the wiki" })).toBe("hello from the wiki");
  });

  it("redacts serialized OTel attributes without consuming adjacent JSON fields", () => {
    const serialized =
      '{"note":"Bearer token","other":"preserve me","nested":' +
      '["Authorization: Bearer nested-token",{"value":"plain"}],"__proto__":"preserve too"}';

    expect(JSON.parse(maskTelemetryData({ data: serialized }) as string)).toEqual({
      note: "Bearer [REDACTED]",
      other: "preserve me",
      nested: ["Authorization: Bearer [REDACTED]", { value: "plain" }],
      ["__proto__"]: "preserve too",
    });
  });

  it("does not throw on unexpected values", () => {
    expect(maskTelemetryData({ data: Symbol("x") })).toBeDefined();
  });

  it("propagates masking failures instead of returning unredacted telemetry", () => {
    const failure = new Error("masking failed");
    const payload = {
      get secret(): string {
        throw failure;
      },
    };

    expect(() => maskTelemetryData({ data: payload })).toThrow(failure);
  });
});

describe("getLangfuseSpanProcessor", () => {
  it("shares one processor through the global symbol registry", async () => {
    process.env.LANGFUSE_PUBLIC_KEY = "pk-test";
    process.env.LANGFUSE_SECRET_KEY = "sk-test";

    const first = getLangfuseSpanProcessor();
    const second = getLangfuseSpanProcessor();

    expect(first).not.toBeNull();
    expect(second).toBe(first);
    expect(
      (globalThis as Record<symbol, unknown>)[Symbol.for("gdgjp.agents.langfuseSpanProcessor")],
    ).toBe(first);

    await first?.shutdown();
    delete (globalThis as Record<symbol, unknown>)[
      Symbol.for("gdgjp.agents.langfuseSpanProcessor")
    ];
  });
});

describe("disabled telemetry is a network no-op", () => {
  it("observeInquiry runs the callback with a no-op span", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    let ran = false;
    await observeInquiry({ platform: "discord", chatUserId: "u1" }, async (span) => {
      span.update({ input: "q", output: "a" });
      ran = true;
      return 42;
    });
    expect(ran).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("flushTelemetry resolves without fetching", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    await expect(flushTelemetry()).resolves.toBeUndefined();
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});
