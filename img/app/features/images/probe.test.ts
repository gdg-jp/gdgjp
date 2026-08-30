import { describe, expect, it, vi } from "vitest";
import { probeImageDimensions } from "./probe";

describe("probeImageDimensions", () => {
  it("returns dimensions for raster images", async () => {
    const env = {
      IMAGES: {
        info: vi.fn().mockResolvedValue({ format: "image/png", fileSize: 1, width: 4, height: 3 }),
      },
    } as unknown as Env;
    await expect(probeImageDimensions(env, new ArrayBuffer(1))).resolves.toEqual({
      width: 4,
      height: 3,
    });
  });

  it("returns null for SVG image info", async () => {
    const env = {
      IMAGES: { info: vi.fn().mockResolvedValue({ format: "image/svg+xml" }) },
    } as unknown as Env;
    await expect(probeImageDimensions(env, new ArrayBuffer(1))).resolves.toBeNull();
  });

  it("returns null instead of rejecting when Images throws", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const env = {
      IMAGES: { info: vi.fn().mockRejectedValue(new Error("bad image")) },
    } as unknown as Env;
    await expect(probeImageDimensions(env, new ArrayBuffer(1))).resolves.toBeNull();
  });
});
