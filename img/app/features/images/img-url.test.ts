import { describe, expect, it } from "vitest";
import { deliveryUrl, hasTransform, parseTransformOpts } from "./img-url";

describe("image delivery URLs", () => {
  it("round trips all transform options", () => {
    const value = {
      w: 800,
      h: 450,
      dpr: 2.5,
      fit: "cover",
      radius: 24,
      q: 75,
      f: "webp",
      variant: "mobile",
    } as const;
    const url = deliveryUrl("Ab3dEf9h", value);
    expect(parseTransformOpts(new URL(url, "https://img.gdgs.jp"))).toEqual(value);
  });

  it("round trips the original escape hatch and clamps dpr", () => {
    expect(parseTransformOpts(new URL("https://img.gdgs.jp/x?f=original&dpr=9"))).toEqual({
      dpr: 3,
      f: "original",
    });
  });

  it("does not treat dpr alone as an explicit transform", () => {
    expect(hasTransform({ dpr: 3 })).toBe(false);
  });

  it("normalizes a positive radius and ignores zero", () => {
    expect(parseTransformOpts(new URL("https://img.gdgs.jp/x?radius=9999"))).toEqual({
      radius: 2048,
    });
    expect(parseTransformOpts(new URL("https://img.gdgs.jp/x?radius=0"))).toEqual({});
    expect(hasTransform({ radius: 24 })).toBe(true);
  });
});
