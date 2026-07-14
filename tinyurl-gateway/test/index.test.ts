import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:dns/promises", () => ({
  resolve4: vi.fn(async () => ["203.0.113.10"]),
  resolve6: vi.fn(async () => []),
}));

import { clearConfigCacheForTests, handleGatewayRequest } from "../api/index.js";

function config(mode: "short-only" | "origin-first", upstreamOrigin: string | null) {
  return new Response(JSON.stringify({ hostname: "custom.example", mode, upstreamOrigin }), {
    headers: { "content-type": "application/json" },
  });
}

describe("gateway", () => {
  beforeEach(() => {
    clearConfigCacheForTests();
    process.env.TINYURL_INTERNAL_BASE = "https://url.gdgs.jp";
    process.env.GATEWAY_SHARED_SECRET = "test-secret";
    vi.restoreAllMocks();
  });

  it("passes through a successful origin response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = new URL(String(input));
        if (url.hostname === "url.gdgs.jp") return config("origin-first", "https://origin.example");
        return new Response("origin", { status: 200 });
      }),
    );
    const response = await handleGatewayRequest(new Request("https://custom.example/about"));
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("origin");
  });

  it("reconstructs relative request targets provided by the Vercel runtime", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
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

  it("forwards plain-object headers from the Vercel Node runtime", async () => {
    let forwardedUserAgent: string | null = null;
    let forwardedRequestId: string | null = null;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
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
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = new URL(String(input));
        if (url.pathname.endsWith("/config"))
          return config("origin-first", "https://origin.example");
        if (url.pathname.endsWith("/resolve"))
          return new Response(null, {
            status: 302,
            headers: { location: "https://destination.example" },
          });
        return new Response("origin missing", { status: 404 });
      }),
    );
    const response = await handleGatewayRequest(new Request("https://custom.example/about"));
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("https://destination.example");
  });

  it("preserves a 404 when no short link exists", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
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
  });

  it("supports HEAD fallback with a HEAD-signed resolver request", async () => {
    const methods: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
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
        const url = new URL(String(input));
        if (url.hostname === "url.gdgs.jp") return config("origin-first", "https://origin.example");
        if (networkFailure) throw new Error("offline");
        return new Response("broken", { status: 503 });
      }),
    );
    expect((await handleGatewayRequest(new Request("https://custom.example/a"))).status).toBe(503);
    clearConfigCacheForTests();
    networkFailure = true;
    expect((await handleGatewayRequest(new Request("https://custom.example/a"))).status).toBe(502);
  });

  it("rejects non-read requests in short-only mode and unknown hosts", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = new URL(String(input));
        return url.hostname === "url.gdgs.jp" ? config("short-only", null) : new Response(null);
      }),
    );
    const post = await handleGatewayRequest(
      new Request("https://custom.example/a", { method: "POST" }),
    );
    expect(post.status).toBe(405);

    clearConfigCacheForTests();
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
});
