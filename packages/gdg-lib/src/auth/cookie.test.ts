import { describe, expect, it } from "vitest";
import {
  clearedCookie,
  parseCookies,
  readCookie,
  serializeCookie,
  signPayload,
  verifyPayload,
} from "./cookie";

function base64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

async function hmac(body: string, secret: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return base64Url(new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(body))));
}

describe("signPayload / verifyPayload", () => {
  const secret = "test-secret-do-not-use-in-prod";

  it("round-trips a JSON payload", async () => {
    const payload = { userId: "u_123", chapters: ["osaka"], n: 42 };
    const signed = await signPayload(payload, secret);
    const verified = await verifyPayload<typeof payload>(signed, secret);
    expect(verified).toEqual(payload);
  });

  it("emits an unpadded base64url body and an HMAC-SHA256 signature", async () => {
    const payload = { v: "??>???ab" };
    const signed = await signPayload(payload, secret);
    const body = base64Url(new TextEncoder().encode(JSON.stringify(payload)));

    expect(signed).toBe(`${body}.${await hmac(body, secret)}`);
    expect(signed).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    await expect(verifyPayload(signed, secret)).resolves.toEqual(payload);
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

  it("rejects malformed values, including a correctly signed body that is not JSON", async () => {
    expect(await verifyPayload<unknown>("not-signed", secret)).toBeNull();
    expect(await verifyPayload<unknown>(".sig-only", secret)).toBeNull();
    expect(await verifyPayload<unknown>("", secret)).toBeNull();

    const body = base64Url(new TextEncoder().encode("not json"));
    expect(await verifyPayload<unknown>(`${body}.${await hmac(body, secret)}`, secret)).toBeNull();
  });
});

describe("serializeCookie", () => {
  it("emits sane defaults: Secure, HttpOnly, SameSite=Lax, Path=/", () => {
    expect(serializeCookie({ name: "s", value: "abc" })).toBe(
      "s=abc; Path=/; Secure; HttpOnly; SameSite=Lax",
    );
  });

  it("respects secure: false (for localhost)", () => {
    expect(serializeCookie({ name: "s", value: "abc", secure: false })).toBe(
      "s=abc; Path=/; HttpOnly; SameSite=Lax",
    );
  });

  it("renders every provided attribute in order", () => {
    expect(
      serializeCookie({
        name: "s",
        value: "abc",
        maxAge: 600,
        expires: new Date(0),
        path: "/auth",
        domain: "gdgs.jp",
        httpOnly: false,
        sameSite: "None",
      }),
    ).toBe(
      "s=abc; Max-Age=600; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Path=/auth; Domain=gdgs.jp; Secure; SameSite=None",
    );
  });
});

describe("clearedCookie", () => {
  it("returns a cookie that immediately expires", () => {
    expect(clearedCookie("s")).toBe(
      "s=; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Path=/; Secure; HttpOnly; SameSite=Lax",
    );
    expect(clearedCookie("s", "/auth")).toContain("; Path=/auth;");
  });
});

describe("parseCookies", () => {
  it("returns empty object for null header", () => {
    expect(parseCookies(null)).toEqual({});
  });

  it("parses a simple cookie header", () => {
    expect(parseCookies("a=1; b=two")).toEqual({ a: "1", b: "two" });
  });

  it("decodes URL-encoded values and trims whitespace around them", () => {
    expect(parseCookies("token= a%2Cb ")).toEqual({ token: "a,b" });
  });

  it("skips malformed entries", () => {
    expect(parseCookies("a=1; nokey; =noname; c=3")).toEqual({ a: "1", c: "3" });
  });
});

describe("readCookie", () => {
  it("returns the named cookie or null", () => {
    const request = new Request("https://x.example/", { headers: { cookie: "a=1; b=2" } });
    expect(readCookie(request, "b")).toBe("2");
    expect(readCookie(request, "c")).toBeNull();
  });
});
