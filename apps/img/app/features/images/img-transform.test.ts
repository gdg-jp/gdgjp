import { describe, expect, it } from "vitest";
import {
  DEFAULT_FIT,
  DEFAULT_QUALITY,
  isCanonical,
  negotiateFormat,
  resolveDelivery,
  snapWidth,
} from "./img-transform";

const source = { contentType: "image/jpeg", byteSize: 20_000, width: 2000, height: 1000 };

describe("image transform resolution", () => {
  it.each([
    ["image/avif,image/webp,*/*", "image/jpeg", "avif"],
    ["image/webp,*/*", "image/jpeg", "webp"],
    ["*/*", "image/png", "png"],
    ["*/*", "image/jpeg", "jpeg"],
    ["image/avif,image/webp", "image/gif", "webp"],
  ])("negotiates %s for %s as %s", (accept, contentType, expected) => {
    expect(negotiateFormat(accept, contentType)).toBe(expected);
  });

  it.each([
    [1, 160],
    [161, 320],
    [1600, 1600],
    [9999, 4096],
  ])("snaps %i to %i", (input, expected) => expect(snapWidth(input)).toBe(expected));

  it("folds dpr into explicit dimensions before snapping", () => {
    const result = resolveDelivery({
      params: { w: 800, dpr: 2 },
      accept: "*/*",
      autoMaxWidth: 0,
      source,
    });
    expect(result.kind === "derive" ? result.transform.width : null).toBe(1600);
  });

  it("ignores dpr without an explicit dimension", () => {
    const result = resolveDelivery({
      params: { dpr: 3 },
      accept: "*/*",
      autoMaxWidth: 1600,
      source,
    });
    expect(result.kind === "derive" ? result.transform.width : null).toBe(1600);
  });

  it("does not allow AVIF to destroy GIF animation", () => {
    expect(
      resolveDelivery({
        params: { f: "avif" },
        accept: "image/avif",
        autoMaxWidth: 0,
        source: { ...source, contentType: "image/gif" },
      }),
    ).toEqual({ kind: "passthrough", reason: "animated" });
  });

  it("uses an alpha-capable format for rounded corners", () => {
    const automatic = resolveDelivery({
      params: { radius: 24 },
      accept: "*/*",
      autoMaxWidth: 0,
      source,
    });
    const explicitJpeg = resolveDelivery({
      params: { radius: 24, f: "jpeg" },
      accept: "*/*",
      autoMaxWidth: 0,
      source,
    });
    expect(automatic.kind === "derive" ? automatic.transform.format : null).toBe("png");
    expect(explicitJpeg.kind === "derive" ? explicitJpeg.transform.format : null).toBe("png");
  });

  it.each([
    [{ f: "original" }, "image/jpeg", 20_000, "explicit-original"],
    [{}, "image/svg+xml", 20_000, "svg"],
    [{}, "image/gif", 20_000, "animated"],
    [{}, "image/png", 100, "too-small"],
  ] as const)("passes through special cases", (params, contentType, byteSize, reason) => {
    expect(
      resolveDelivery({
        params,
        accept: "image/avif",
        autoMaxWidth: 1600,
        source: { ...source, contentType, byteSize },
      }),
    ).toEqual({ kind: "passthrough", reason });
  });

  it("does not upscale a known source", () => {
    const result = resolveDelivery({
      params: { w: 3200 },
      accept: "*/*",
      autoMaxWidth: 0,
      source: { ...source, width: 700 },
    });
    expect(result.kind === "derive" ? result.transform.width : null).toBe(700);
  });

  it("recognizes only the bounded preset set as canonical", () => {
    expect(
      isCanonical({ width: 1600, fit: DEFAULT_FIT, quality: DEFAULT_QUALITY, format: "avif" }),
    ).toBe(true);
    expect(
      isCanonical({
        width: 1600,
        height: 900,
        fit: DEFAULT_FIT,
        quality: DEFAULT_QUALITY,
        format: "avif",
      }),
    ).toBe(false);
    expect(
      isCanonical({ width: 1600, fit: "cover", quality: DEFAULT_QUALITY, format: "avif" }),
    ).toBe(false);
    expect(
      isCanonical({
        width: 1600,
        fit: DEFAULT_FIT,
        quality: DEFAULT_QUALITY,
        radius: 24,
        format: "avif",
      }),
    ).toBe(false);
  });
});
