import { describe, expect, it } from "vitest";
import { clearedCookie, parseCookies, serializeCookie, signPayload, verifyPayload } from "./cookie";

describe("signPayload / verifyPayload", () => {
  const secret = "test-secret-do-not-use-in-prod";

  it("round-trips a JSON payload", async () => {
    const payload = { userId: "u_123", chapters: ["osaka"], n: 42 };
    const signed = await signPayload(payload, secret);
    const verified = await verifyPayload<typeof payload>(signed, secret);
    expect(verified).toEqual(payload);
  });

  it("rejects payloads signed with a different secret", async () => {
    const signed = await signPayload({ a: 1 }, secret);
    const verified = await verifyPayload<unknown>(signed, "different-secret");
    expect(verified).toBeNull();
  });

  it("rejects a tampered payload body", async () => {
    const signed = await signPayload({ a: 1 }, secret);
    const [, sig] = signed.split(".");
    const tampered = `${btoa(JSON.stringify({ a: 2 }))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "")}.${sig}`;
    const verified = await verifyPayload<unknown>(tampered, secret);
    expect(verified).toBeNull();
  });

  it("rejects malformed values", async () => {
    expect(await verifyPayload<unknown>("not-signed", secret)).toBeNull();
    expect(await verifyPayload<unknown>(".sig-only", secret)).toBeNull();
    expect(await verifyPayload<unknown>("", secret)).toBeNull();
  });
});

describe("serializeCookie", () => {
  it("emits sane defaults: Secure, HttpOnly, SameSite=Lax, Path=/", () => {
    const out = serializeCookie({ name: "s", value: "abc" });
    expect(out).toContain("s=abc");
    expect(out).toContain("Path=/");
    expect(out).toContain("Secure");
    expect(out).toContain("HttpOnly");
    expect(out).toContain("SameSite=Lax");
  });

  it("respects secure: false (for localhost)", () => {
    const out = serializeCookie({ name: "s", value: "abc", secure: false });
    expect(out).not.toContain("Secure");
  });

  it("includes Max-Age when provided", () => {
    const out = serializeCookie({ name: "s", value: "abc", maxAge: 600 });
    expect(out).toContain("Max-Age=600");
  });
});

describe("clearedCookie", () => {
  it("returns a cookie that immediately expires", () => {
    const out = clearedCookie("s");
    expect(out).toContain("s=");
    expect(out).toContain("Max-Age=0");
    expect(out).toContain("Expires=Thu, 01 Jan 1970");
  });
});

describe("parseCookies", () => {
  it("returns empty object for null header", () => {
    expect(parseCookies(null)).toEqual({});
  });

  it("parses a simple cookie header", () => {
    expect(parseCookies("a=1; b=two")).toEqual({ a: "1", b: "two" });
  });

  it("decodes URL-encoded values", () => {
    expect(parseCookies("token=a%2Cb")).toEqual({ token: "a,b" });
  });

  it("skips malformed entries", () => {
    expect(parseCookies("a=1; nokey; =noname; c=3")).toEqual({ a: "1", c: "3" });
  });
});
