import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync } from "node:fs";
import { type IncomingHttpHeaders, type Server, createServer as createHttpServer } from "node:http";
import { createServer as createHttpsServer, request as httpsRequest } from "node:https";
import { type AddressInfo, type Socket, createServer as createNetServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Browser, type BrowserContext, chromium } from "@playwright/test";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { scanForSecrets, zipEntries } from "../scripts/secret-scan.mjs";
import { accessScope } from "./access";
import { selfSignedCertificate } from "./certificate";
import { type Dial, type Forwarder, startForwarder } from "./forwarder";

const token = { id: "forwarder-test-id-5c1d", secret: "forwarder-test-secret-9f2e7a" };
const jwt = "eyJhbGciOiJub25lIn0.eyJzdWIiOiJmb3J3YXJkZXIifQ.signature-0123456789";
const domain = "stg.fuzz.test";
const rp = `https://rp.${domain}`;
const accounts = `https://accounts.${domain}`;
const scope = accessScope({ domain });
const required = Boolean(process.env.UI_PROPERTIES_REQUIRE_BROWSER);

type Seen = {
  host: string;
  path: string;
  method: string;
  id: string | undefined;
  secret: string | undefined;
  cookie: string;
  body: string;
};

const seen: Seen[] = [];
const outsideSeen: IncomingHttpHeaders[] = [];
const unexpectedDials: Dial[] = [];
const serverSockets = new Set<Socket>();
let release: () => void = () => undefined;
let upstreamPort = 0;
let outsidePort = 0;
let upstreamCa: Buffer = Buffer.alloc(0);
let upstream: Server;
let outside: Server;
let forwarder: Forwarder | null = null;
let browser: Browser | null = null;

const page = (body: string) => `<!doctype html><main>${body}</main>`;

function authorized(headers: IncomingHttpHeaders) {
  return (
    headers["cf-access-client-id"] === token.id &&
    headers["cf-access-client-secret"] === token.secret
  );
}

function respond(host: string, path: string, method: string) {
  const key = `${method} ${host}${path}`;
  if (key === `GET rp.${domain}/home`)
    return {
      status: 200,
      headers: {
        "content-type": "text/html",
        "set-cookie": ["app=1; Path=/; Secure; HttpOnly", `CF_Authorization=${jwt}; Path=/`],
      },
      body: page("<h1>home</h1><a href='/a'>a</a>"),
    };
  if (key === `GET rp.${domain}/a`) return { status: 302, headers: { location: "/b" } };
  if (key === `GET rp.${domain}/form`)
    return {
      status: 200,
      headers: { "content-type": "text/html" },
      body: page(
        "<form method='post' action='/submit'><input name='x' value='1'><button>Send</button></form>",
      ),
    };
  if (key === `POST rp.${domain}/submit`) return { status: 303, headers: { location: "/done" } };
  if (key === `GET rp.${domain}/signin`)
    return { status: 302, headers: { location: `${accounts}/authorize?client=rp` } };
  if (key === `GET accounts.${domain}/authorize?client=rp`)
    return { status: 302, headers: { location: `${rp}/callback?code=1` } };
  if (key === `GET rp.${domain}/off`)
    return {
      status: 302,
      headers: { location: `http://127.0.0.1:${outsidePort}/landed` },
    };
  return {
    status: 200,
    headers: { "content-type": "text/html" },
    body: page(`<h1>${host}${path}</h1>`),
  };
}

async function listen(server: Server | ReturnType<typeof createNetServer>) {
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", () => done()));
  return (server.address() as AddressInfo).port;
}

function guardedForwarder(upstreamAt: number) {
  return startForwarder({
    scope,
    token,
    upstream: { kind: "loopback", address: "127.0.0.1", port: upstreamAt, ca: upstreamCa },
    onDial: (dial) => {
      if (dial.address !== "127.0.0.1" || dial.port !== upstreamAt) unexpectedDials.push(dial);
    },
  });
}

async function launch(through: Forwarder) {
  return chromium.launch({ args: [...through.chromiumArgs] });
}

beforeAll(async () => {
  const certificate = selfSignedCertificate([`*.${domain}`, domain]);
  upstreamCa = certificate.cert;
  upstream = createHttpsServer(
    { key: certificate.key, cert: certificate.cert },
    (request, response) => {
      const chunks: Buffer[] = [];
      request.on("data", (chunk: Buffer) => chunks.push(chunk));
      request.on("end", () => {
        const host = request.headers.host ?? "";
        const path = request.url ?? "";
        seen.push({
          host,
          path,
          method: request.method ?? "",
          id: request.headers["cf-access-client-id"] as string | undefined,
          secret: request.headers["cf-access-client-secret"] as string | undefined,
          cookie: request.headers.cookie ?? "",
          body: Buffer.concat(chunks).toString(),
        });
        if (!authorized(request.headers)) {
          response
            .writeHead(302, { location: "https://gdgjp.cloudflareaccess.com/cdn-cgi/access/login" })
            .end();
          return;
        }
        if (path === "/stream") {
          response.writeHead(200, { "content-type": "text/plain" });
          response.write("first\n");
          release = () => response.end("second\n");
          return;
        }
        const answer = respond(host, path, request.method ?? "GET");
        response.writeHead(answer.status, answer.headers).end(answer.body ?? "");
      });
    },
  );
  upstream.on("upgrade", (request, socket) => {
    seen.push({
      host: request.headers.host ?? "",
      path: request.url ?? "",
      method: "UPGRADE",
      id: request.headers["cf-access-client-id"] as string | undefined,
      secret: request.headers["cf-access-client-secret"] as string | undefined,
      cookie: request.headers.cookie ?? "",
      body: "",
    });
    if (!authorized(request.headers)) {
      socket.end("HTTP/1.1 403 Forbidden\r\ncontent-length: 0\r\n\r\n");
      return;
    }
    const accept = createHash("sha1")
      .update(`${request.headers["sec-websocket-key"]}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
      .digest("base64");
    socket.write(
      `HTTP/1.1 101 Switching Protocols\r\nupgrade: websocket\r\nconnection: Upgrade\r\nsec-websocket-accept: ${accept}\r\n\r\n`,
    );
    const payload = Buffer.from("hello through the forwarder");
    socket.write(Buffer.concat([Buffer.from([0x81, payload.length]), payload]));
  });
  outside = createHttpServer((request, response) => {
    outsideSeen.push(request.headers);
    response.writeHead(200, { "content-type": "text/html" }).end(page("<h1>outside</h1>"));
  });
  for (const server of [upstream, outside])
    server.on("connection", (socket: Socket) => {
      serverSockets.add(socket);
      socket.on("close", () => serverSockets.delete(socket));
    });
  upstreamPort = await listen(upstream);
  outsidePort = await listen(outside);
  forwarder = await guardedForwarder(upstreamPort);
  browser = await launch(forwarder).catch((error: Error) => {
    if (required) throw error;
    return null;
  });
}, 60_000);

afterAll(async () => {
  await browser?.close();
  await forwarder?.close();
  for (const socket of serverSockets) socket.destroy();
  await Promise.all(
    [upstream, outside].map(
      (server) =>
        new Promise((done) => {
          server.close(done);
          server.closeAllConnections();
        }),
    ),
  );
  expect(unexpectedDials).toEqual([]);
});

async function withContext<T>(body: (context: BrowserContext) => Promise<T>): Promise<T> {
  const context = await (browser as Browser).newContext();
  try {
    return await body(context);
  } finally {
    await context.close();
  }
}

function direct(options: { servername: string; host: string; path: string; port: number }) {
  return new Promise<number>((done, reject) => {
    const request = httpsRequest(
      {
        host: "127.0.0.1",
        port: options.port,
        servername: options.servername,
        path: options.path,
        headers: { host: options.host },
        rejectUnauthorized: false,
        agent: false,
      },
      (response) => {
        response.resume();
        done(response.statusCode ?? 0);
      },
    );
    request.on("error", reject);
    request.end();
  });
}

describe("the Access forwarder", () => {
  it("keeps every hop of a redirect chain between slot hosts authorized", async (context) => {
    if (!browser) return context.skip();
    const from = seen.length;
    await withContext(async (browserContext) => {
      const tab = await browserContext.newPage();
      await tab.goto(`${rp}/home`);
      await tab.goto(`${rp}/a`);
      expect(tab.url()).toBe(`${rp}/b`);
      await tab.goto(`${rp}/form`);
      await Promise.all([
        tab.waitForURL(`${rp}/done`),
        tab.getByRole("button", { name: "Send" }).click(),
      ]);
      await tab.goto(`${rp}/signin`);
      expect(tab.url()).toBe(`${rp}/callback?code=1`);
      const cookies = await browserContext.cookies();
      expect(cookies.map((cookie) => `${cookie.name}@${cookie.domain}`)).toEqual([
        `app@rp.${domain}`,
      ]);
    });
    const hops = seen.slice(from).filter((entry) => entry.path !== "/favicon.ico");
    expect(hops.map((entry) => `${entry.method} ${entry.host}${entry.path}`)).toEqual([
      `GET rp.${domain}/home`,
      `GET rp.${domain}/a`,
      `GET rp.${domain}/b`,
      `GET rp.${domain}/form`,
      `POST rp.${domain}/submit`,
      `GET rp.${domain}/done`,
      `GET rp.${domain}/signin`,
      `GET accounts.${domain}/authorize?client=rp`,
      `GET rp.${domain}/callback?code=1`,
    ]);
    for (const entry of seen.slice(from)) {
      expect([entry.path, entry.id, entry.secret]).toEqual([entry.path, token.id, token.secret]);
      expect(entry.cookie).not.toContain("CF_Authorization");
    }
    expect(hops.find((entry) => entry.method === "POST")?.body).toBe("x=1");
  }, 60_000);

  it("gives a redirect off the slot neither the token nor a cookie", async (context) => {
    if (!browser) return context.skip();
    const from = outsideSeen.length;
    await withContext(async (browserContext) => {
      const tab = await browserContext.newPage();
      await tab.goto(`${rp}/home`);
      await tab.goto(`${rp}/off`);
      expect(tab.url()).toBe(`http://127.0.0.1:${outsidePort}/landed`);
    });
    const landed = outsideSeen.slice(from);
    expect(landed.length).toBeGreaterThan(0);
    for (const headers of landed) {
      expect(headers["cf-access-client-id"]).toBeUndefined();
      expect(headers["cf-access-client-secret"]).toBeUndefined();
      expect(headers.cookie).toBeUndefined();
    }
  }, 60_000);

  it("never sends an http URL on a slot host through the forwarder", async (context) => {
    if (!browser || !forwarder) return context.skip();
    const dials = forwarder.dials.length;
    const from = seen.length;
    await withContext(async (browserContext) => {
      const tab = await browserContext.newPage();
      for (const url of [
        `http://rp.${domain}/plain`,
        `http://rp.${domain}:443/plain`,
        `https://rp.${domain}:8443/port`,
      ])
        await expect(tab.goto(url)).rejects.toThrow(/ERR_/);
    });
    expect(forwarder.dials.length).toBe(dials);
    expect(seen.length).toBe(from);
  }, 60_000);

  it("streams responses and WebSocket upgrades with the token added", async (context) => {
    if (!browser) return context.skip();
    const from = seen.length;
    await withContext(async (browserContext) => {
      const tab = await browserContext.newPage();
      await tab.goto(`${rp}/home`);
      const first = await tab.evaluate(async () => {
        const response = await fetch("/stream");
        const reader = (response.body as ReadableStream<Uint8Array>).getReader();
        const chunk = await Promise.race([
          reader.read(),
          new Promise<null>((done) => setTimeout(() => done(null), 5_000)),
        ]);
        return chunk && !chunk.done ? new TextDecoder().decode(chunk.value) : "buffered";
      });
      release();
      expect(first).toBe("first\n");
      const message = await tab.evaluate(
        (url) =>
          new Promise<string>((done, fail) => {
            const socket = new WebSocket(url);
            socket.onmessage = (event) => done(String(event.data));
            socket.onerror = () => fail(new Error("WebSocket failed"));
          }),
        `wss://rp.${domain}/ws`,
      );
      expect(message).toBe("hello through the forwarder");
    });
    const upgrade = seen.slice(from).find((entry) => entry.method === "UPGRADE");
    expect(upgrade).toMatchObject({ path: "/ws", id: token.id, secret: token.secret });
  }, 60_000);

  it("records the slot requests in a trace without the credential", async (context) => {
    if (!browser) return context.skip();
    const path = join(mkdtempSync(join(tmpdir(), "ui-fuzz-forwarder-trace-")), "trace.zip");
    await withContext(async (browserContext) => {
      await browserContext.tracing.start({ snapshots: true, screenshots: true });
      const tab = await browserContext.newPage();
      await tab.goto(`${rp}/home`);
      await tab.goto(`${rp}/a`);
      await browserContext.tracing.stop({ path });
    });
    expect(
      scanForSecrets([path], {
        CF_ACCESS_CLIENT_ID: token.id,
        CF_ACCESS_CLIENT_SECRET: token.secret,
        CF_Authorization: jwt,
      }),
    ).toEqual([]);
    const network = zipEntries(readFileSync(path))
      .filter((entry) => entry.name.endsWith(".network"))
      .map((entry) => entry.data.toString())
      .join("\n");
    expect(network).toContain(`${rp}/a`);
    expect(network).toContain(`${rp}/b`);
  }, 60_000);

  it("refuses a host it does not serve and never dials anything but https", async () => {
    if (!forwarder) throw new Error("no forwarder");
    const dials = forwarder.dials.length;
    const at = forwarder.port;
    const host = `rp.${domain}`;
    expect(
      await direct({
        servername: "evil.example.com",
        host: "evil.example.com",
        path: "/",
        port: at,
      }),
    ).toBe(421);
    expect(await direct({ servername: host, host: "evil.example.com", path: "/", port: at })).toBe(
      421,
    );
    expect(await direct({ servername: "evil.example.com", host, path: "/", port: at })).toBe(421);
    expect(await direct({ servername: host, host: `${host}:8443`, path: "/", port: at })).toBe(421);
    expect(
      await direct({ servername: host, host, path: "https://evil.example.com/", port: at }),
    ).toBe(421);
    expect(await direct({ servername: host, host, path: "//evil.example.com/", port: at })).toBe(
      421,
    );
    expect(forwarder.dials.length).toBe(dials);
    expect(await direct({ servername: host, host, path: "/direct", port: at })).toBe(200);
    const received: Buffer[] = [];
    const plain = createNetServer((socket) => {
      socket.on("data", (chunk) => received.push(chunk));
      socket.on("error", () => undefined);
      setTimeout(() => socket.destroy(), 200);
    });
    const plainPort = await listen(plain);
    const downgraded = await guardedForwarder(plainPort);
    try {
      expect(await direct({ servername: host, host, path: "/", port: downgraded.port })).toBe(502);
    } finally {
      await downgraded.close();
      await new Promise((done) => plain.close(done));
    }
    expect(Buffer.concat(received).includes(token.secret)).toBe(false);
    expect(Buffer.concat(received).includes(token.id)).toBe(false);
    await expect(
      startForwarder({
        scope,
        token,
        upstream: { kind: "loopback", address: "10.0.0.1", port: 443, ca: upstreamCa },
      }),
    ).rejects.toThrow(/loopback address/);
    await expect(
      startForwarder({
        scope: accessScope({ domain: "stg1.gdgs.jp" }),
        token,
        upstream: { kind: "loopback", address: "127.0.0.1", port: 443, ca: upstreamCa },
      }),
    ).rejects.toThrow(/\.test domain/);
    await expect(startForwarder({ scope, token, upstream: { kind: "dns" } })).rejects.toThrow(
      /test domain/,
    );
  }, 60_000);

  it("fails closed when the forwarder stops", async (context) => {
    if (!browser) return context.skip();
    const stopping = await guardedForwarder(upstreamPort);
    const isolated = await launch(stopping);
    try {
      const tab = await (await isolated.newContext()).newPage();
      await tab.goto(`${rp}/home`);
      await stopping.close();
      const from = seen.length;
      await expect(tab.goto(`${rp}/a`)).rejects.toThrow(/ERR_/);
      expect(seen.length).toBe(from);
    } finally {
      await isolated.close();
    }
  }, 60_000);
});
