import { describe, expect, it } from "vitest";
import { connpassCookieHeader } from "./checkin-fetch.server";

function envWith(cookies: { name: string; value: string; domain: string; expires?: number }[]) {
  return {
    SESSION_KV: { get: async () => JSON.stringify({ cookies, origins: [] }) },
  } as unknown as Env;
}

describe("connpassCookieHeader", () => {
  it("sends only cookies of connpass.com and its subdomains", async () => {
    const header = await connpassCookieHeader(
      envWith([
        { name: "a", value: "1", domain: ".connpass.com" },
        { name: "b", value: "2", domain: "gdg.connpass.com" },
        { name: "c", value: "3", domain: "evilconnpass.com" },
        { name: "d", value: "4", domain: "connpass.com.evil.example" },
      ]),
    );
    expect(header).toBe("a=1; b=2");
  });

  it("drops expired cookies", async () => {
    const header = await connpassCookieHeader(
      envWith([{ name: "old", value: "x", domain: "connpass.com", expires: 1 }]),
    );
    expect(header).toBeNull();
  });
});
