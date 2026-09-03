import { describe, expect, it } from "vitest";
import { hashId, maskEventData, redactValue } from "../src/mask.js";

describe("maskEventData / redactValue", () => {
  it("redacts Bearer tokens regardless of configured secrets", () => {
    const input = { headers: { authorization: "Bearer abc123.def-456_ghi" } };
    const result = maskEventData(input, []) as typeof input;
    expect(result.headers.authorization).toBe("Bearer [REDACTED]");
  });

  it("redacts JWT-shaped strings", () => {
    const jwt =
      "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U"; // gitleaks:allow
    const result = maskEventData({ token: jwt }, []) as { token: string };
    expect(result.token).toBe("[REDACTED]");
  });

  it("redacts an exact match of a configured secret passed in explicitly", () => {
    const secret = "sk-lf-super-secret-value";
    const result = maskEventData({ output: `leaked: ${secret}` }, [secret]) as { output: string };
    expect(result.output).toBe("leaked: [REDACTED]");
  });

  it("does NOT redact a value that only happens to match process.env — the caller must pass secrets explicitly", () => {
    // Regression: maskEventData() used to default to reading secrets from
    // process.env, but the forwarder's systemd unit never exports
    // LANGFUSE_SECRET_KEY as an env var (it only exists in the credentials
    // JSON file) — so that default silently redacted nothing in production.
    const originalEnv = process.env.LANGFUSE_SECRET_KEY;
    process.env.LANGFUSE_SECRET_KEY = "sk-lf-env-value";
    try {
      const result = maskEventData({ output: "leaked: sk-lf-env-value" }, []) as { output: string };
      expect(result.output).toBe("leaked: sk-lf-env-value");
    } finally {
      if (originalEnv === undefined) process.env.LANGFUSE_SECRET_KEY = undefined;
      else process.env.LANGFUSE_SECRET_KEY = originalEnv;
    }
  });

  it("deep-walks arrays and nested objects", () => {
    const secret = "topsecret";
    const input = { a: [{ b: { c: `x-${secret}-y` } }] };
    const result = maskEventData(input, [secret]) as typeof input;
    expect(result.a[0].b.c).toBe("x-[REDACTED]-y");
  });

  it("leaves ordinary content untouched (masking is a backstop, not a content filter)", () => {
    const input = { question: "Summarize the venue-cost policy.", answer: "The cap is ¥50,000." };
    const result = maskEventData(input, []) as typeof input;
    expect(result).toEqual(input);
  });

  it("redactValue requires an explicit secrets list (no implicit env default)", () => {
    // TypeScript enforces this at compile time; this just documents that the
    // signature has no default value for `secrets`.
    expect(redactValue("plain string", [])).toBe("plain string");
  });
});

describe("hashId", () => {
  it("is deterministic for the same input and salt", () => {
    expect(hashId("discord-user-123", "salt-a")).toBe(hashId("discord-user-123", "salt-a"));
  });

  it("differs across salts (so two deployments cannot correlate raw ids)", () => {
    expect(hashId("discord-user-123", "salt-a")).not.toBe(hashId("discord-user-123", "salt-b"));
  });

  it("never returns the raw input", () => {
    const raw = "discord-user-123";
    expect(hashId(raw, "salt")).not.toContain(raw);
  });

  it("differs across inputs for the same salt", () => {
    expect(hashId("user-a", "salt")).not.toBe(hashId("user-b", "salt"));
  });
});
