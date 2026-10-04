import { describe, expect, it, vi } from "vitest";

import { resolvePrincipal } from "../src/authz.ts";
import { dispatchRequest } from "../src/daemon/rpc.ts";
import type { IndexStore } from "../src/indexer/store.ts";

vi.mock("../src/authz.ts", () => ({ resolvePrincipal: vi.fn() }));

describe("RPC search boundary", () => {
  it("uses the configured authz endpoint and returns only navigation metadata", async () => {
    vi.mocked(resolvePrincipal).mockResolvedValue({
      classes: [{ chapterId: "tokyo", role: "member" }],
      channelAudience: { kind: "member" },
    });
    const embed = vi.fn(async () => new Float32Array(384));
    const store = {
      search: () => [
        {
          id: 1,
          path: "pages/event/page.md",
          startLine: 3,
          endLine: 5,
          text: "private document body must never be serialized",
          distance: 0,
          subject: { visibility: "member", chapterId: null },
          aclSourceIds: [],
        },
      ],
    } as unknown as IndexStore;
    const raw = JSON.stringify({
      id: 1,
      method: "tools/call",
      nonce: "caller-nonce",
      authzSocketPath: "/fake.sock",
      params: {
        name: "search",
        arguments: { query: "event", limit: 1, classes: [], authzSocketPath: "/fake.sock" },
      },
    });
    const input = {
      store,
      embedder: { embed },
      sourceMetadata: new Map(),
      authzSocketPath: "/service/authz.sock",
    };
    const reply = JSON.parse(await dispatchRequest(raw, input));
    const results = [{ path: "pages/event/page.md", startLine: 3, endLine: 5, score: 1 }];
    expect(resolvePrincipal).toHaveBeenCalledWith("caller-nonce", "/service/authz.sock");
    expect(reply.result).toEqual({
      content: [{ type: "text", text: JSON.stringify(results) }],
      structuredContent: { results },
    });

    vi.mocked(resolvePrincipal).mockResolvedValue(null);
    embed.mockClear();
    const denied = JSON.parse(await dispatchRequest(raw, input));
    expect(denied.result.structuredContent.results).toEqual([]);
    expect(embed).not.toHaveBeenCalled();
  });

  it.each(["{", "null", "[]", "1"])("rejects malformed request %s", async (raw) => {
    const result = JSON.parse(
      await dispatchRequest(raw, {
        store: {} as IndexStore,
        embedder: { embed: async () => new Float32Array(384) },
        sourceMetadata: new Map(),
        authzSocketPath: "/service/authz.sock",
      }),
    );
    expect(result.error.message).toBe("Invalid JSON-RPC request");
  });
});
