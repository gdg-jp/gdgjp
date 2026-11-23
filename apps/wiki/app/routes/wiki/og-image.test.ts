import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const pageRow = vi.fn<() => Promise<unknown>>();
const isSpacePublic = vi.fn(async () => true);
const cacheMatch = vi.fn(async () => new Response("stale image", { status: 200 }));

vi.mock("@cloudflare/puppeteer", () => ({
  default: { launch: vi.fn(async () => Promise.reject(new Error("no browser in tests"))) },
}));
vi.mock("~/lib/db.server", () => ({
  getDb: () => ({
    select: () => ({ from: () => ({ where: () => ({ get: () => pageRow() }) }) }),
  }),
}));
vi.mock("~/features/spaces/access.server", () => ({
  getSpaceBySlug: async () => ({ id: "gdg-jp", slug: "gdg-jp" }),
  isSpacePublic: () => isSpacePublic(),
}));

import { loader } from "./og-image";

function loaderArgs() {
  const request = new Request("https://wiki.example/s/gdg-jp/wiki/once-public/og-image.png");
  return {
    request,
    context: { cloudflare: { env: {} as Env, ctx: { waitUntil: () => {} } } } as never,
    params: { space: "gdg-jp", slug: "once-public" },
    unstable_pattern: "/s/:space/wiki/:slug/og-image.png",
    unstable_url: new URL(request.url),
  };
}

beforeEach(() => {
  pageRow.mockReset();
  isSpacePublic.mockReset().mockResolvedValue(true);
  cacheMatch.mockClear();
  vi.stubGlobal("caches", { default: { match: cacheMatch, put: vi.fn() } });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("og-image loader visibility before cache", () => {
  it("returns 404 for a page re-restricted after its image was cached", async () => {
    pageRow.mockResolvedValue(undefined);
    await expect(loader(loaderArgs())).rejects.toMatchObject({ status: 404 });
    expect(cacheMatch).not.toHaveBeenCalled();
  });

  it("returns 404 for a space made private after its image was cached", async () => {
    isSpacePublic.mockResolvedValue(false);
    pageRow.mockResolvedValue({ titleJa: "t", titleEn: "", contentJa: "", contentEn: "" });
    await expect(loader(loaderArgs())).rejects.toMatchObject({ status: 404 });
    expect(cacheMatch).not.toHaveBeenCalled();
  });

  it("serves the cached image while the page stays visible", async () => {
    pageRow.mockResolvedValue({ titleJa: "t", titleEn: "", contentJa: "", contentEn: "" });
    const response = await loader(loaderArgs());
    expect(await response.text()).toBe("stale image");
  });
});
