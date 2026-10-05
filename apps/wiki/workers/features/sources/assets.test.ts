import { afterEach, describe, expect, it, vi } from "vitest";
import { assetR2Key, resolveSourceAssets } from "./assets";
import { sha256Hex } from "./persist";

const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

function imageResponse(bytes: Uint8Array, contentType = "image/png"): Response {
  return new Response(bytes.slice().buffer as ArrayBuffer, {
    status: 200,
    headers: { "Content-Type": contentType },
  });
}

function envWith(putMock: ReturnType<typeof vi.fn>): Env {
  return { BUCKET: { put: putMock } } as unknown as Env;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("resolveSourceAssets", () => {
  it("stores the image and rewrites the placeholder to its R2 key", async () => {
    const putMock = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(imageResponse(PNG)));

    const hash = await sha256Hex(PNG);
    const result = await resolveSourceAssets(envWith(putMock), {
      sourceId: "src-1",
      markdown: "# Venue\n\n![floor plan](attachment:kix.abc123)\n",
      images: [{ objectId: "kix.abc123", sourceUrl: "https://lh3.example/img", altText: "floor" }],
      accessToken: "token-1",
    });

    const expectedKey = `raw/src-1/assets/kix_abc123-${hash}.png`;
    expect(result.markdown).toContain(`![floor plan](${expectedKey})`);
    expect(result.markdown).not.toContain("attachment:");
    expect(result.assets).toEqual([
      {
        path: expectedKey,
        r2Key: expectedKey,
        mimeType: "image/png",
        byteSize: PNG.byteLength,
        contentHash: hash,
      },
    ]);
    expect(putMock.mock.calls[0][0]).toBe(expectedKey);
  });

  it("derives the same key for unchanged content so document hashes stay stable", async () => {
    const putMock = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(() => Promise.resolve(imageResponse(PNG))),
    );

    const input = {
      sourceId: "src-1",
      markdown: "![](attachment:kix.abc123)",
      images: [{ objectId: "kix.abc123", sourceUrl: "https://lh3.example/img" }],
      accessToken: "token-1",
    };

    const first = await resolveSourceAssets(envWith(putMock), input);
    const second = await resolveSourceAssets(envWith(putMock), input);

    // A random asset id here would change the markdown on every refresh, which would
    // change the document's content_hash and rewrite R2 even when nothing changed.
    expect(second.markdown).toBe(first.markdown);
  });

  it("drops the placeholder when an image has expired instead of losing the text", async () => {
    const putMock = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 404 })));

    const result = await resolveSourceAssets(envWith(putMock), {
      sourceId: "src-1",
      markdown: "Before\n\n![gone](attachment:kix.missing)\n\nAfter",
      images: [{ objectId: "kix.missing", sourceUrl: "https://lh3.example/gone" }],
      accessToken: "token-1",
    });

    expect(result.markdown).toContain("Before");
    expect(result.markdown).toContain("After");
    expect(result.markdown).not.toContain("attachment:");
    expect(result.assets).toEqual([]);
    expect(putMock).not.toHaveBeenCalled();
  });

  it("rejects non-image responses", async () => {
    const putMock = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(imageResponse(PNG, "text/html")));

    await expect(
      resolveSourceAssets(envWith(putMock), {
        sourceId: "src-1",
        markdown: "![](attachment:kix.abc123)",
        images: [{ objectId: "kix.abc123", sourceUrl: "https://lh3.example/img" }],
        accessToken: "token-1",
      }),
    ).rejects.toThrow(/invalid image type/i);
  });
});

describe("assetR2Key", () => {
  it("keeps keys inside the source's raw prefix and sanitizes the object id", () => {
    expect(assetR2Key("src-1", "kix.ab/c", "deadbeef", "image/webp")).toBe(
      "raw/src-1/assets/kix_ab_c-deadbeef.webp",
    );
  });
});
