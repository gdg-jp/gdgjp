import { describe, expect, it } from "vitest";
import {
  hashToken,
  parseFromHeader,
  participantCookieHeaders,
  randomToken,
  verify,
} from "./participant-cookie";

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

function attributes(setCookie: string) {
  const [pair, ...rest] = setCookie.split("; ");
  return {
    pair,
    path: rest.find((attr) => attr.startsWith("Path="))?.slice("Path=".length),
    maxAge: rest.find((attr) => attr.startsWith("Max-Age="))?.slice("Max-Age=".length),
    flags: rest,
  };
}

function pathMatches(cookiePath: string, requestPath: string): boolean {
  if (requestPath === cookiePath) return true;
  if (!requestPath.startsWith(cookiePath)) return false;
  return cookiePath.endsWith("/") || requestPath[cookiePath.length] === "/";
}

describe("participantCookieHeaders", () => {
  it("scopes the guest cookie so React Router data requests for the event carry it", () => {
    const [cookie] = participantCookieHeaders("evt_x", 42, "TOK", { secure: true }).getSetCookie();
    const { pair, path, flags } = attributes(cookie);
    expect(pair).toBe("scheduler_p_evt_x=42.TOK");
    expect(flags).toEqual(expect.arrayContaining(["HttpOnly", "SameSite=Lax", "Secure"]));
    for (const requestPath of ["/e/evt_x", "/e/evt_x.data", "/e/evt_x/edit"]) {
      expect(pathMatches(path ?? "", requestPath), requestPath).toBe(true);
    }
  });

  it("expires the cookie that earlier releases scoped to the event page path", () => {
    const [, legacy] = participantCookieHeaders("evt_x", 42, "TOK", {
      secure: false,
    }).getSetCookie();
    expect(attributes(legacy)).toMatchObject({
      pair: "scheduler_p_evt_x=",
      path: "/e/evt_x",
      maxAge: "0",
    });
    expect(legacy).not.toContain("Secure");
  });
});

describe("parseFromHeader", () => {
  it("returns every credential for the event in header order", () => {
    const header =
      "other=1; scheduler_p_evt_x=7.OLD; scheduler_p_evt_y=9.Y; scheduler_p_evt_x=42.TOK";
    expect(parseFromHeader(header, "evt_x")).toEqual([
      { participantId: 7, token: "OLD" },
      { participantId: 42, token: "TOK" },
    ]);
  });

  it("ignores missing or malformed values", () => {
    expect(parseFromHeader(null, "evt_x")).toEqual([]);
    expect(parseFromHeader("", "evt_x")).toEqual([]);
    expect(parseFromHeader("scheduler_p_evt_x=garbage", "evt_x")).toEqual([]);
    expect(parseFromHeader("scheduler_p_evt_x=0.T", "evt_x")).toEqual([]);
  });
});
