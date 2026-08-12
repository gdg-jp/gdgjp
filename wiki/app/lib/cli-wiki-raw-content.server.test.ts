import { describe, expect, it } from "vitest";
import { rawDownloadContentType } from "~/lib/cli-wiki-raw-content.server";

describe("rawDownloadContentType", () => {
  it("avoids text/html so Cloudflare HTML rewrites cannot change hashed bytes", () => {
    expect(rawDownloadContentType("text/html")).toBe("application/octet-stream");
    expect(rawDownloadContentType("text/html; charset=utf-8")).toBe("application/octet-stream");
  });

  it("preserves non-HTML media types", () => {
    expect(rawDownloadContentType("text/css")).toBe("text/css; charset=utf-8");
    expect(rawDownloadContentType("text/markdown")).toBe("text/markdown; charset=utf-8");
    expect(rawDownloadContentType("application/pdf")).toBe("application/pdf");
    expect(rawDownloadContentType("image/png")).toBe("image/png");
  });
});
