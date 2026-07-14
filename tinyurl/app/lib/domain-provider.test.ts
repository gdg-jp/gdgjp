import { beforeEach, describe, expect, it, vi } from "vitest";
import { VercelDomainProvider } from "./domain-provider";

describe("VercelDomainProvider", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("creates a domain and returns API-provided DNS records", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          name: "example.jp",
          verified: false,
          verification: [
            { type: "TXT", domain: "_vercel.example.jp", value: "challenge", reason: "ownership" },
          ],
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          misconfigured: true,
          recommendedIPv4: [{ rank: 1, value: "203.0.113.8" }],
        }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const state = await new VercelDomainProvider("token", "project", "team").create("example.jp");

    expect(state.verified).toBe(false);
    expect(state.configured).toBe(false);
    expect(state.records).toEqual([
      { type: "TXT", name: "_vercel.example.jp", value: "challenge", reason: "ownership" },
      { type: "A", name: "@", value: "203.0.113.8", reason: "Vercel apex routing" },
    ]);
    expect(String(fetchMock.mock.calls[0][0])).toContain("teamId=team");
  });

  it("verifies, checks, and removes through project domain endpoints", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ name: "example.jp", verified: true }))
      .mockResolvedValueOnce(Response.json({ misconfigured: false }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    const provider = new VercelDomainProvider("token", "project");

    expect((await provider.verify("example.jp")).configured).toBe(true);
    await provider.remove("example.jp");
    expect(fetchMock.mock.calls[0][1]?.method).toBe("POST");
    expect(fetchMock.mock.calls[2][1]?.method).toBe("DELETE");
  });

  it("surfaces provider failures without exposing the token", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ error: { message: "domain limit" } }, { status: 400 })),
    );
    const provider = new VercelDomainProvider("super-secret", "project");
    await expect(provider.create("example.jp")).rejects.toThrow("domain limit");
    await expect(provider.create("example.jp")).rejects.not.toThrow("super-secret");
  });
});
