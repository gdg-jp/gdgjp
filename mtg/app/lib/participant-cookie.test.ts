import { describe, expect, it } from "vitest";
import {
  cookieName,
  hashToken,
  parseFromHeader,
  randomToken,
  serializeCookie,
  verify,
} from "./participant-cookie";

describe("cookieName", () => {
  it("uses per-event name", () => {
    expect(cookieName("evt_abc")).toBe("mtg_p_evt_abc");
  });
});

describe("randomToken", () => {
  it("produces base32 26-char strings", () => {
    const t = randomToken();
    expect(t).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    const t2 = randomToken();
    expect(t).not.toBe(t2);
  });
});

describe("hashToken", () => {
  it("is deterministic and hex", async () => {
    const a = await hashToken("hello");
    const b = await hashToken("hello");
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });
  it("differs for different inputs", async () => {
    expect(await hashToken("a")).not.toBe(await hashToken("b"));
  });
});

describe("verify", () => {
  it("returns true for equal strings", () => {
    expect(verify("abc", "abc")).toBe(true);
  });
  it("returns false for unequal", () => {
    expect(verify("abc", "abd")).toBe(false);
    expect(verify("abc", "abcd")).toBe(false);
  });
});

describe("serializeCookie / parseFromHeader", () => {
  it("round-trips through Cookie header", () => {
    const cookie = serializeCookie("evt_x", 42, "TOK", { secure: true });
    expect(cookie).toContain("mtg_p_evt_x=42.TOK");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Path=/e/evt_x");
    expect(cookie).toContain("Secure");

    const header = "other=1; mtg_p_evt_x=42.TOK; another=2";
    const parsed = parseFromHeader(header, "evt_x");
    expect(parsed).toEqual({ participantId: 42, token: "TOK" });
  });

  it("omits Secure when not secure", () => {
    const cookie = serializeCookie("evt_x", 1, "T", { secure: false });
    expect(cookie).not.toContain("Secure");
  });

  it("returns null for missing or malformed", () => {
    expect(parseFromHeader(null, "evt_x")).toBeNull();
    expect(parseFromHeader("", "evt_x")).toBeNull();
    expect(parseFromHeader("mtg_p_evt_x=garbage", "evt_x")).toBeNull();
    expect(parseFromHeader("mtg_p_evt_x=0.T", "evt_x")).toBeNull();
  });
});
