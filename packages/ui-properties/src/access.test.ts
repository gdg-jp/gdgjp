import {
  type IncomingHttpHeaders,
  type IncomingMessage,
  type Server,
  type ServerResponse,
  createServer,
} from "node:http";
import type { AddressInfo } from "node:net";
import { gzipSync } from "node:zlib";
import { type Browser, type Route, chromium } from "@playwright/test";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  accessToken,
  browserEnvironment,
  forwardThroughAccess,
  routeThroughAccess,
  sendThroughAccess,
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
  if (request.headers["cf-access-client-secret"] !== token.secret) {
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
  if (request.url === "/echo") {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      response.writeHead(201, {
        "content-type": "application/json",
        "content-encoding": "gzip",
        "set-cookie": ["app=1; Path=/; HttpOnly", "CF_Authorization=jwt; Path=/; HttpOnly"],
      });
      response.end(
        gzipSync(
          JSON.stringify({
            method: request.method,
            body: Buffer.concat(chunks).toString(),
            cookie: request.headers.cookie ?? null,
            pageHeader: request.headers["x-page"] ?? null,
          }),
        ),
      );
    });
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

describe("sendThroughAccess", () => {
  it("adds the token itself, follows no redirect, and keeps Access's cookie from the browser", async () => {
    const redirect = await sendThroughAccess(
      { url: `${slotUrl}/short`, method: "GET", headers: {}, body: null },
      token,
    );
    expect(redirect.status).toBe(302);
    expect(redirect.headers.location).toBe(`${outsideUrl}/landed`);
    expect(redirect.headers["set-cookie"]).toBeUndefined();
    expect(outside.seen.some((entry) => entry.path === "/landed")).toBe(false);
    const echoed = await sendThroughAccess(
      {
        url: `${slotUrl}/echo`,
        method: "POST",
        headers: {
          "content-type": "text/plain",
          "content-length": "5",
          cookie: "app=1; CF_Authorization=stale",
          "CF-Access-Client-Secret": "from-the-page",
          "x-page": "kept",
        },
        body: Buffer.from("hello"),
      },
      token,
    );
    expect(echoed.status).toBe(201);
    expect(echoed.headers["content-encoding"]).toBeUndefined();
    expect(echoed.headers["set-cookie"]).toBe("app=1; Path=/; HttpOnly");
    expect(JSON.parse(echoed.body.toString())).toEqual({
      method: "POST",
      body: "hello",
      cookie: "app=1",
      pageHeader: "kept",
    });
  });
});

describe("forwardThroughAccess", () => {
  const fake = (url: string) => {
    const calls: { method: string; options: unknown }[] = [];
    const route = {
      request: () => ({
        url: () => url,
        method: () => "POST",
        allHeaders: async () => ({ accept: "text/html", cookie: "app=1" }),
        postDataBuffer: () => Buffer.from("x"),
      }),
      continue: async (options?: unknown) => {
        calls.push({ method: "continue", options });
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

  it("sends slot requests from the test process and leaves other hosts untouched", async () => {
    const inSlot = slotHosts("stg1.gdgs.jp");
    const sent: unknown[] = [];
    const send = async (request: unknown) => {
      sent.push(request);
      return { status: 302, headers: { location: "https://example.com/" }, body: Buffer.alloc(0) };
    };
    const within = fake("https://url.stg1.gdgs.jp/abc");
    await forwardThroughAccess(within.route, inSlot, token, send);
    expect(sent).toEqual([
      {
        url: "https://url.stg1.gdgs.jp/abc",
        method: "POST",
        headers: { accept: "text/html", cookie: "app=1" },
        body: Buffer.from("x"),
      },
    ]);
    expect(within.calls).toEqual([
      {
        method: "fulfill",
        options: {
          status: 302,
          headers: { location: "https://example.com/" },
          body: Buffer.alloc(0),
        },
      },
    ]);
    const failed = fake("https://url.stg1.gdgs.jp/down");
    await forwardThroughAccess(failed.route, inSlot, token, async () => {
      throw new Error("refused");
    });
    expect(failed.calls.map((call) => call.method)).toEqual(["abort"]);
    const beyond = fake("https://example.com/landed");
    await forwardThroughAccess(beyond.route, inSlot, token, send);
    expect(beyond.calls).toEqual([{ method: "continue", options: undefined }]);
    expect(sent).toHaveLength(1);
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
      const echoed = await page.evaluate(
        async (url) => (await fetch(url, { method: "POST", body: "from the page" })).json(),
        `${slotUrl}/echo`,
      );
      expect(echoed).toMatchObject({ method: "POST", body: "from the page" });
      await page.goto(`${slotUrl}/short`);
      await page.waitForURL(`${outsideUrl}/landed`);
      expect(
        (await browserContext.cookies()).map((cookie) => `${cookie.name}@${cookie.domain}`).sort(),
      ).toEqual(["app@localhost", "session@localhost"]);
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
    expect(slot.seen.some((entry) => entry.headers.cookie?.includes("app=1"))).toBe(true);
    expect(slot.seen.some((entry) => entry.headers.cookie?.includes("CF_Authorization"))).toBe(
      false,
    );
    expect(outside.seen.map((entry) => entry.path)).toEqual(["/landed", "/api", "/landed"]);
    for (const entry of outside.seen) {
      expect(entry.headers["cf-access-client-id"]).toBeUndefined();
      expect(entry.headers["cf-access-client-secret"]).toBeUndefined();
      expect(entry.headers.cookie ?? "").not.toMatch(/CF_Authorization|session=|app=/);
    }
  }, 60_000);
});
