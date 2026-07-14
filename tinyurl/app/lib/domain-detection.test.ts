import { afterEach, describe, expect, it, vi } from "vitest";
import { detectCustomDomain } from "./domain-detection";

function dnsResponse(answers: Array<{ data: string; type: number }>, status = 0) {
  return Response.json({ Status: status, Answer: answers });
}

function mockDns(url: URL): Response {
  const type = url.searchParams.get("type");
  if (type === "A") return dnsResponse([{ data: "8.8.8.8", type: 1 }]);
  if (type === "CNAME") return dnsResponse([{ data: "hosting.example.", type: 5 }]);
  return dnsResponse([]);
}

describe("detectCustomDomain", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("selects origin-first when a public HTTPS website responds", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = new URL(input.toString());
        return url.hostname === "cloudflare-dns.com"
          ? mockDns(url)
          : new Response(null, { status: 200 });
      }),
    );

    await expect(detectCustomDomain("Example.COM.")).resolves.toEqual({
      hostname: "example.com",
      mode: "origin-first",
      existingSite: true,
      suggestedUpstreamOrigin: "https://origin.example.com",
      dns: {
        status: "resolved",
        observations: expect.arrayContaining([
          { type: "A", value: "8.8.8.8", public: true },
          { type: "CNAME", value: "hosting.example", public: null },
        ]),
      },
      https: { status: "reachable", statusCode: 200, finalUrl: "https://example.com/" },
    });
  });

  it("treats any HTTPS response, including a root 404, as an existing site", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = new URL(input.toString());
        return url.hostname === "cloudflare-dns.com"
          ? mockDns(url)
          : new Response(null, { status: 404 });
      }),
    );

    const result = await detectCustomDomain("example.com");
    expect(result).toMatchObject({ existingSite: true, mode: "origin-first" });
  });

  it("selects short-only and skips HTTPS when DNS has no addresses", async () => {
    const fetchMock = vi.fn(async () => dnsResponse([], 3));
    vi.stubGlobal("fetch", fetchMock);

    await expect(detectCustomDomain("unused.example")).resolves.toMatchObject({
      mode: "short-only",
      existingSite: false,
      dns: { status: "not-found", observations: [] },
      https: { status: "not-checked" },
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("does not connect to a hostname with a private DNS answer", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(input.toString());
      const type = url.searchParams.get("type");
      return type === "A" ? dnsResponse([{ data: "10.0.0.1", type: 1 }]) : dnsResponse([]);
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(detectCustomDomain("internal.example")).resolves.toMatchObject({
      mode: "short-only",
      dns: { status: "unsafe" },
      https: { status: "not-checked" },
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("blocks redirects to private or unresolved hosts", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = new URL(input.toString());
        if (url.hostname === "cloudflare-dns.com") {
          const name = url.searchParams.get("name");
          const type = url.searchParams.get("type");
          if (name === "private.example" && type === "A") {
            return dnsResponse([{ data: "192.168.1.2", type: 1 }]);
          }
          return mockDns(url);
        }
        return new Response(null, {
          status: 302,
          headers: { location: "https://private.example/" },
        });
      }),
    );

    await expect(detectCustomDomain("example.com")).resolves.toMatchObject({
      mode: "short-only",
      existingSite: false,
      https: { status: "unsafe-redirect", statusCode: 302 },
    });
  });

  it("returns a safe error status when DNS lookup fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 503 })),
    );
    await expect(detectCustomDomain("example.com")).resolves.toMatchObject({
      mode: "short-only",
      dns: { status: "error", observations: [] },
    });
  });
});
