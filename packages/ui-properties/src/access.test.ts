import {
  type IncomingHttpHeaders,
  type IncomingMessage,
  type Server,
  type ServerResponse,
  createServer,
} from "node:http";
import type { AddressInfo } from "node:net";
import { type Browser, type Route, chromium } from "@playwright/test";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  accessToken,
  browserEnvironment,
  forwardThroughAccess,
  routeThroughAccess,
  slotHosts,
} from "./access";

const token = { id: "fuzz-client-id", secret: "fuzz-client-secret" };

type Seen = { path: string; headers: IncomingHttpHeaders };

function recording(handle: (request: IncomingMessage, response: ServerResponse) => void) {
  const seen: Seen[] = [];
  const server = createServer((request, response) => {
    seen.push({ path: request.url ?? "", headers: request.headers });
    handle(request, response);
  });
  return { server, seen };
}

const port = (server: Server) => (server.address() as AddressInfo).port;

let browser: Browser | null = null;
let slotUrl = "";
let outsideUrl = "";

const outside = recording((_request, response) => {
  response
    .writeHead(200, { "content-type": "text/html", "access-control-allow-origin": "*" })
    .end("<main><a href='/'>outside</a></main>");
});

const slot = recording((request, response) => {
  const authorized =
    request.headers["cf-access-client-secret"] === token.secret ||
    /CF_Authorization=jwt/.test(request.headers.cookie ?? "");
  if (!authorized) {
    response.writeHead(403).end("Access denied");
    return;
  }
  if (request.url === "/short") {
    response
      .writeHead(302, {
        location: `${outsideUrl}/landed`,
        "set-cookie": "CF_Authorization=jwt; Path=/; HttpOnly",
      })
      .end();
    return;
  }
  if (request.url === "/fetch") {
    response.writeHead(307, { location: `${outsideUrl}/api` }).end();
    return;
  }
  response
    .writeHead(200, { "content-type": "text/html" })
    .end("<main><a href='/short'>short link</a></main>");
});

beforeAll(async () => {
  browser = await chromium
    .launch({ args: ["--disable-features=LocalNetworkAccessChecks"] })
    .catch((error: Error) => {
      if (process.env.UI_PROPERTIES_REQUIRE_BROWSER) throw error;
      return null;
    });
  await new Promise<void>((done) => outside.server.listen(0, "127.0.0.1", done));
  outsideUrl = `http://127.0.0.1:${port(outside.server)}`;
  await new Promise<void>((done) => slot.server.listen(0, "localhost", done));
  slotUrl = `http://localhost:${port(slot.server)}`;
});

afterAll(async () => {
  await browser?.close();
  await Promise.all(
    [slot.server, outside.server].map((server) => new Promise((done) => server.close(done))),
  );
});

describe("slotHosts", () => {
  it("matches the slot's domain and its subdomains only", () => {
    const inSlot = slotHosts("stg1.gdgs.jp");
    expect(inSlot("https://stg1.gdgs.jp/")).toBe(true);
    expect(inSlot("https://wiki.stg1.gdgs.jp/x")).toBe(true);
    expect(inSlot("https://evilstg1.gdgs.jp/")).toBe(false);
    expect(inSlot("https://stg1.gdgs.jp.example.com/")).toBe(false);
    expect(slotHosts(undefined)("https://wiki.stg1.gdgs.jp/")).toBe(false);
    expect(
      browserEnvironment({ PATH: "/bin", CF_ACCESS_CLIENT_ID: "i", CF_ACCESS_CLIENT_SECRET: "s" }),
    ).toEqual({ PATH: "/bin" });
    expect(accessToken({ CF_ACCESS_CLIENT_ID: "i" })).toBeNull();
    expect(accessToken({ CF_ACCESS_CLIENT_ID: "i", CF_ACCESS_CLIENT_SECRET: "s" })).toEqual({
      id: "i",
      secret: "s",
    });
  });
});

describe("forwardThroughAccess", () => {
  const fake = (url: string) => {
    const calls: { method: string; options: unknown }[] = [];
    const route = {
      request: () => ({ url: () => url, headers: () => ({ accept: "text/html" }) }),
      continue: async (options?: unknown) => {
        calls.push({ method: "continue", options });
      },
      fetch: async (options?: unknown) => {
        calls.push({ method: "fetch", options });
        return { status: () => 302 };
      },
      fulfill: async (options?: unknown) => {
        calls.push({ method: "fulfill", options });
      },
      abort: async () => {
        calls.push({ method: "abort", options: undefined });
      },
    };
    return { route: route as unknown as Route, calls };
  };

  it("sends the token itself without following redirects and never through the browser", async () => {
    const inSlot = slotHosts("stg1.gdgs.jp");
    const within = fake("https://url.stg1.gdgs.jp/abc");
    await forwardThroughAccess(within.route, inSlot, token);
    expect(within.calls.map((call) => call.method)).toEqual(["fetch", "fulfill"]);
    expect(within.calls[0]?.options).toEqual({
      headers: {
        accept: "text/html",
        "CF-Access-Client-Id": token.id,
        "CF-Access-Client-Secret": token.secret,
      },
      maxRedirects: 0,
    });
    const beyond = fake("https://example.com/landed");
    await forwardThroughAccess(beyond.route, inSlot, token);
    expect(beyond.calls).toEqual([{ method: "continue", options: undefined }]);
  });
});

describe("routeThroughAccess in a browser", () => {
  it("gives a redirect target outside the slot neither the token nor the slot's cookies", async (context) => {
    if (!browser) return context.skip();
    const browserContext = await browser.newContext();
    await browserContext.addCookies([
      { name: "session", value: "slot-only", domain: "localhost", path: "/", httpOnly: true },
    ]);
    await routeThroughAccess(browserContext, slotHosts("localhost"), token);
    const page = await browserContext.newPage();
    try {
      await page.goto(`${slotUrl}/`);
      await page.getByRole("link", { name: "short link" }).click();
      await page.waitForURL(`${outsideUrl}/landed`);
      await page.goto(`${slotUrl}/`);
      const fetched = await page.evaluate(
        async (url) => (await fetch(url)).status,
        `${slotUrl}/fetch`,
      );
      expect(fetched).toBe(200);
      await page.goto(`${slotUrl}/short`);
      await page.waitForURL(`${outsideUrl}/landed`);
    } finally {
      const state = JSON.stringify(await browserContext.storageState());
      await browserContext.close();
      expect(state).not.toContain(token.secret);
    }
    expect(
      slot.seen.filter((entry) => entry.headers["cf-access-client-secret"]).length,
    ).toBeGreaterThan(0);
    expect(slot.seen.some((entry) => entry.headers.cookie?.includes("session=slot-only"))).toBe(
      true,
    );
    expect(outside.seen.map((entry) => entry.path)).toEqual(["/landed", "/api", "/landed"]);
    for (const entry of outside.seen) {
      expect(entry.headers["cf-access-client-id"]).toBeUndefined();
      expect(entry.headers["cf-access-client-secret"]).toBeUndefined();
      expect(entry.headers.cookie ?? "").not.toMatch(/CF_Authorization|session=/);
    }
  }, 60_000);
});
