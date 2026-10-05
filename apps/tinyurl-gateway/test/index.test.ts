import { beforeEach, describe, expect, it, vi } from "vitest";

import { createHmac } from "node:crypto";

import * as gatewayModule from "../api/index.js";

import { clearDomainConfigCacheForTests } from "../src/domain-config.js";
import { handleGatewayRequest } from "../src/gateway.js";
import { resolveShortLink } from "../src/internal-api.js";
import { fetchOrigin } from "../src/origin-proxy.js";
import { clearSharedCacheForTests } from "../src/runtime-cache.js";
import { clearUpstreamDnsCacheForTests, validateUpstreamOrigin } from "../src/upstream.js";

function clearLocalCachesForTests(): void {
  clearDomainConfigCacheForTests();
  clearUpstreamDnsCacheForTests();
}

async function clearConfigCacheForTests(): Promise<void> {
  clearLocalCachesForTests();
  await clearSharedCacheForTests();
}

function config(mode: "short-only" | "origin-first", upstreamOrigin: string | null) {
  return new Response(JSON.stringify({ hostname: "custom.example", mode, upstreamOrigin }), {
    headers: { "content-type": "application/json" },
  });
}

function dnsResponse(input: RequestInfo | URL): Response | null {
  const url = new URL(String(input));
  if (url.hostname !== "cloudflare-dns.com") return null;
  const answer = url.searchParams.get("type") === "A" ? [{ type: 1, data: "203.0.113.10" }] : [];
  return Response.json({ Status: 0, Answer: answer });
}

describe("gateway", () => {
  beforeEach(async () => {
    await clearConfigCacheForTests();
    process.env.TINYURL_INTERNAL_BASE = "https://url.gdgs.jp";
    process.env.GATEWAY_SHARED_SECRET = "test-secret";
    vi.restoreAllMocks();
  });

  it("exports an Edge Runtime handler in the Tokyo region", () => {
    expect(gatewayModule.config).toEqual({ runtime: "edge", regions: ["hnd1"] });
    expect(typeof gatewayModule.default).toBe("function");
  });

  it("proxies robots.txt from an origin-first upstream", async () => {
    let resolverRequests = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const dns = dnsResponse(input);
        if (dns) return dns;
        const url = new URL(String(input));
        if (url.pathname.endsWith("/config")) {
          return config("origin-first", "https://origin.example");
        }
        if (url.pathname.endsWith("/resolve")) {
          resolverRequests += 1;
          return new Response(null, { status: 204 });
        }
        expect(url).toEqual(new URL("https://origin.example/robots.txt"));
        return new Response("User-agent: *\nDisallow:\n", {
          headers: { "content-type": "text/plain; charset=utf-8" },
        });
      }),
    );

    const response = await handleGatewayRequest(new Request("https://custom.example/robots.txt"));

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    expect(await response.text()).toBe("User-agent: *\nDisallow:\n");
    expect(resolverRequests).toBe(0);
  });

  it("prevents clients from decoding an already-decoded origin response", async () => {
    let upstreamAcceptEncoding: string | null = null;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const dns = dnsResponse(input);
        if (dns) return dns;
        const url = new URL(String(input));
        if (url.hostname === "url.gdgs.jp") {
          return config("origin-first", "https://origin.example");
        }
        upstreamAcceptEncoding = new Headers(init?.headers).get("accept-encoding");
        return new Response("decoded origin", {
          headers: {
            "content-encoding": "br",
            "content-length": "7",
            "content-type": "text/html",
          },
        });
      }),
    );

    const response = await handleGatewayRequest(
      new Request("https://custom.example/", {
        headers: { "accept-encoding": "gzip, br" },
      }),
    );

    expect(upstreamAcceptEncoding).toBe("identity");
    expect(response.headers.get("content-encoding")).toBeNull();
    expect(response.headers.get("content-length")).toBeNull();
    expect(response.headers.get("content-type")).toBe("text/html");
    expect(await response.text()).toBe("decoded origin");
  });

  it("caches public origin responses at Vercel without changing the browser policy", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const dns = dnsResponse(input);
        if (dns) return dns;
        const url = new URL(String(input));
        if (url.hostname === "url.gdgs.jp") {
          return config("origin-first", "https://origin.example");
        }
        return new Response("origin", {
          headers: { "cache-control": "public, max-age=0, must-revalidate" },
        });
      }),
    );

    const response = await handleGatewayRequest(new Request("https://custom.example/asset.css"));

    expect(response.headers.get("cache-control")).toBe("public, max-age=0, must-revalidate");
    expect(response.headers.get("vercel-cdn-cache-control")).toBe(
      "public, max-age=60, stale-while-revalidate=86400",
    );
  });

  it("keeps routing configuration after the local isolate cache is reset", async () => {
    let configRequests = 0;
    let dnsRequests = 0;
    let originRequests = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = new URL(String(input));
        if (url.hostname === "cloudflare-dns.com") {
          dnsRequests += 1;
          return dnsResponse(input) ?? new Response(null, { status: 500 });
        }
        if (url.hostname === "url.gdgs.jp") {
          configRequests += 1;
          return config("origin-first", "https://origin.example");
        }
        originRequests += 1;
        return new Response("origin", {
          headers: { "cache-control": "public, max-age=0, must-revalidate" },
        });
      }),
    );

    await handleGatewayRequest(new Request("https://custom.example/?request=1"));
    clearLocalCachesForTests();
    await handleGatewayRequest(new Request("https://custom.example/?request=2"));

    expect(configRequests).toBe(1);
    expect(dnsRequests).toBe(2);
    expect(originRequests).toBe(2);
  });

  it.each([
    ["private response", {}, { "cache-control": "private, max-age=60" }],
    ["cookie request", { cookie: "session=1" }, { "cache-control": "public, max-age=60" }],
    [
      "set-cookie response",
      {},
      { "cache-control": "public, max-age=60", "set-cookie": "session=1" },
    ],
  ])("does not CDN-cache a %s", async (_name, requestHeaders, responseHeaders) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const dns = dnsResponse(input);
        if (dns) return dns;
        const url = new URL(String(input));
        if (url.hostname === "url.gdgs.jp") {
          return config("origin-first", "https://origin.example");
        }
        return new Response("origin", { headers: responseHeaders });
      }),
    );

    const response = await handleGatewayRequest(
      new Request("https://custom.example/", { headers: requestHeaders }),
    );

    expect(response.headers.get("vercel-cdn-cache-control")).toBeNull();
  });

  it("reconstructs relative request targets provided by the Vercel runtime", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const dns = dnsResponse(input);
        if (dns) return dns;
        const url = new URL(String(input));
        if (url.pathname.endsWith("/config")) return config("short-only", null);
        if (url.pathname.endsWith("/resolve")) return new Response(null, { status: 204 });
        throw new Error(`Unexpected request to ${url}`);
      }),
    );
    const request = {
      url: "/",
      method: "GET",
      headers: { "x-forwarded-host": "custom.example" },
    };

    const response = await handleGatewayRequest(request);
    expect(response.status).toBe(404);
    expect(await response.text()).toBe("Not Found");
  });

  it("forwards plain-object headers from compatibility adapters", async () => {
    let forwardedUserAgent: string | null = null;
    let forwardedRequestId: string | null = null;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const dns = dnsResponse(input);
        if (dns) return dns;
        const url = new URL(String(input));
        if (url.pathname.endsWith("/config")) {
          return config("origin-first", "https://origin.example");
        }
        const headers = new Headers(init?.headers);
        forwardedUserAgent = headers.get("user-agent");
        forwardedRequestId = headers.get("x-request-id");
        return new Response("origin", { status: 200 });
      }),
    );

    const response = await handleGatewayRequest({
      url: "/about",
      method: "GET",
      headers: {
        host: "custom.example",
        "user-agent": "vercel-node-test",
        "x-request-id": "request-1",
      },
    });

    expect(response.status).toBe(200);
    expect(forwardedUserAgent).toBe("vercel-node-test");
    expect(forwardedRequestId).toBe("request-1");
  });

  it("falls back only when a GET origin returns 404", async () => {
    let resolverRedirect: RequestRedirect | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const dns = dnsResponse(input);
        if (dns) return dns;
        const url = new URL(String(input));
        if (url.pathname.endsWith("/config"))
          return config("origin-first", "https://origin.example");
        if (url.pathname.endsWith("/resolve")) {
          resolverRedirect = init?.redirect;
          return new Response(null, {
            status: 302,
            headers: { location: "https://destination.example" },
          });
        }
        return new Response("origin missing", { status: 404 });
      }),
    );
    const response = await handleGatewayRequest(new Request("https://custom.example/about"));
    expect(resolverRedirect).toBe("manual");
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("https://destination.example");
    expect(response.headers.get("vercel-cdn-cache-control")).toBeNull();
  });

  it("preserves a 404 when no short link exists", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const dns = dnsResponse(input);
        if (dns) return dns;
        const url = new URL(String(input));
        if (url.pathname.endsWith("/config"))
          return config("origin-first", "https://origin.example");
        if (url.pathname.endsWith("/resolve")) return new Response(null, { status: 204 });
        return new Response("origin missing", { status: 404 });
      }),
    );
    const response = await handleGatewayRequest(new Request("https://custom.example/missing"));
    expect(response.status).toBe(404);
    expect(await response.text()).toBe("origin missing");
    expect(response.headers.get("vercel-cdn-cache-control")).toBeNull();
  });

  it("supports HEAD fallback with a HEAD-signed resolver request", async () => {
    const methods: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const dns = dnsResponse(input);
        if (dns) return dns;
        const url = new URL(String(input));
        methods.push(init?.method ?? "GET");
        if (url.pathname.endsWith("/config"))
          return config("origin-first", "https://origin.example");
        if (url.pathname.endsWith("/resolve"))
          return new Response(null, {
            status: 302,
            headers: { location: "https://destination.example" },
          });
        return new Response(null, { status: 404 });
      }),
    );
    const response = await handleGatewayRequest(
      new Request("https://custom.example/about", { method: "HEAD" }),
    );
    expect(response.status).toBe(302);
    expect(methods.at(-1)).toBe("HEAD");
  });

  it("does not fall back on origin errors or network failures", async () => {
    let networkFailure = false;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const dns = dnsResponse(input);
        if (dns) return dns;
        const url = new URL(String(input));
        if (url.hostname === "url.gdgs.jp") return config("origin-first", "https://origin.example");
        if (networkFailure) throw new Error("offline");
        return new Response("broken", { status: 503 });
      }),
    );
    expect((await handleGatewayRequest(new Request("https://custom.example/a"))).status).toBe(503);
    await clearConfigCacheForTests();
    networkFailure = true;
    expect((await handleGatewayRequest(new Request("https://custom.example/a"))).status).toBe(502);
  });

  it("rejects non-read requests in short-only mode and unknown hosts", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const dns = dnsResponse(input);
        if (dns) return dns;
        const url = new URL(String(input));
        return url.hostname === "url.gdgs.jp" ? config("short-only", null) : new Response(null);
      }),
    );
    const post = await handleGatewayRequest(
      new Request("https://custom.example/a", { method: "POST" }),
    );
    expect(post.status).toBe(405);

    await clearConfigCacheForTests();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("missing", { status: 404 })),
    );
    const unknown = await handleGatewayRequest(new Request("https://unknown.example/a"));
    expect(unknown.status).toBe(421);
  });

  it("rejects upstream loops", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => config("origin-first", "https://custom.example")),
    );
    const response = await handleGatewayRequest(new Request("https://custom.example/a"));
    expect(response.status).toBe(502);
  });

  it("rejects upstream hostnames that resolve to private addresses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = new URL(String(input));
        const answer = url.searchParams.get("type") === "A" ? [{ type: 1, data: "10.0.0.1" }] : [];
        return Response.json({ Status: 0, Answer: answer });
      }),
    );

    await expect(
      validateUpstreamOrigin("https://origin.custom.example", "custom.example"),
    ).rejects.toThrow("private address");
  });

  it.each([
    "http://origin.example",
    "https://origin.example/path",
    "https://127.0.0.1",
    "https://[::1]",
    "https://localhost",
    "https://origin.local",
    "https://custom.example",
    "https://url.gdgs.jp",
    "https://site.vercel.app",
  ])("rejects unsafe upstream %s before DNS lookup", async (origin) => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(validateUpstreamOrigin(origin, "custom.example")).rejects.toThrow(
      "Unsafe upstream origin",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("signs the resolver method, query and host at the internal API boundary", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    await resolveShortLink(
      new Request("https://custom.example/about", { method: "HEAD" }),
      "custom.example",
      "about",
      "https://custom.example/about",
    );
    const [url, init] = fetchMock.mock.calls[0] as unknown as [URL, RequestInit];
    const headers = new Headers(init.headers);
    const payload = `${headers.get("x-gdg-timestamp")}\nHEAD\n${url.pathname}${url.search}\ncustom.example`;
    expect(init.method).toBe("HEAD");
    expect(init.redirect).toBe("manual");
    expect(headers.get("x-gdg-signature")).toBe(
      createHmac("sha256", "test-secret").update(payload).digest("hex"),
    );
    expect(headers.get("x-gdg-original-url")).toBe("https://custom.example/about");
  });

  it("preserves POST bodies and strips trusted and hop headers at the proxy boundary", async () => {
    const fetchMock = vi.fn(async () => new Response("ok"));
    vi.stubGlobal("fetch", fetchMock);
    await fetchOrigin(
      {
        url: "/submit",
        method: "POST",
        headers: { host: "custom.example", connection: "close", "x-gdg-signature": "forged" },
        body: "payload",
      },
      "custom.example",
      new URL("https://origin.example/submit"),
    );
    const [, init] = fetchMock.mock.calls[0] as unknown as [URL, RequestInit];
    const headers = new Headers(init.headers);
    expect(init.method).toBe("POST");
    expect(init.body).toBe("payload");
    expect(init.redirect).toBe("manual");
    expect(headers.get("host")).toBeNull();
    expect(headers.get("connection")).toBeNull();
    expect(headers.get("x-gdg-signature")).toBeNull();
    expect(headers.get("x-forwarded-host")).toBe("custom.example");
  });
});
