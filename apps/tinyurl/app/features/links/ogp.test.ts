import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchOgp, isPrivateIP, validatePublicHttpUrl } from "~/features/links/ogp";

function dnsResponse(addresses: Array<{ data: string; type: number }>) {
  return Response.json({ Answer: addresses });
}

describe("isPrivateIP", () => {
  it("detects private and loopback address ranges", () => {
    expect(isPrivateIP("10.0.0.1")).toBe(true);
    expect(isPrivateIP("172.16.0.1")).toBe(true);
    expect(isPrivateIP("192.168.1.1")).toBe(true);
    expect(isPrivateIP("127.0.0.1")).toBe(true);
    expect(isPrivateIP("::1")).toBe(true);
    expect(isPrivateIP("fd00::1")).toBe(true);
    expect(isPrivateIP("8.8.8.8")).toBe(false);
    expect(isPrivateIP("2606:4700:4700::1111")).toBe(false);
  });
});

describe("validatePublicHttpUrl", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("rejects non-http schemes", async () => {
    await expect(validatePublicHttpUrl("javascript:alert(1)")).resolves.toMatchObject({
      ok: false,
      reason: "URL must use http or https.",
    });
  });

  it("rejects hostnames that resolve to private addresses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = new URL(input.toString());
        return url.searchParams.get("type") === "A"
          ? dnsResponse([{ data: "192.168.1.10", type: 1 }])
          : dnsResponse([]);
      }),
    );

    await expect(validatePublicHttpUrl("https://internal.example")).resolves.toMatchObject({
      ok: false,
      reason: "URL must not resolve to a private or loopback address.",
    });
  });

  it("accepts hostnames that resolve only to public addresses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = new URL(input.toString());
        return url.searchParams.get("type") === "A"
          ? dnsResponse([{ data: "8.8.8.8", type: 1 }])
          : dnsResponse([]);
      }),
    );

    await expect(validatePublicHttpUrl("https://example.com")).resolves.toMatchObject({
      ok: true,
    });
  });
});

describe("fetchOgp", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses manual redirects and rejects redirects to private addresses", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(input.toString());

      if (url.hostname === "cloudflare-dns.com") {
        const name = url.searchParams.get("name");
        const type = url.searchParams.get("type");
        if (name === "public.example" && type === "A") {
          return dnsResponse([{ data: "8.8.8.8", type: 1 }]);
        }
        if (name === "private.example" && type === "A") {
          return dnsResponse([{ data: "10.0.0.5", type: 1 }]);
        }
        return dnsResponse([]);
      }

      expect(init?.redirect).toBe("manual");
      return new Response(null, {
        status: 302,
        headers: { location: "http://private.example/page" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchOgp("https://public.example")).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalledWith("http://private.example/page", expect.anything());
  });
});
