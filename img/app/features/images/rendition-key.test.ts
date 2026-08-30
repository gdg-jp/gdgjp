import { describe, expect, it } from "vitest";
import { resolveDelivery } from "~/lib/img-transform";
import { parseTransformOpts } from "~/lib/img-url";
import { isValidImageId } from "./id";
import { deliveryEtag, renditionCacheUrl, renditionKey } from "./rendition-key";

const source = { variant: "d", sourceVersion: 1735689600 } as const;
const metadata = { contentType: "image/jpeg", byteSize: 20_000, width: 3000, height: 2000 };

function derive(query: string) {
  return resolveDelivery({
    params: parseTransformOpts(new URL(`https://img.gdgs.jp/x?${query}`)),
    accept: "image/avif",
    autoMaxWidth: 0,
    source: metadata,
  });
}

describe("rendition identity", () => {
  it("is independent of query order", () => {
    const a = derive("w=800&q=80");
    const b = derive("q=80&w=800");
    expect(renditionKey("Ab3dEf9h", source, a)).toBe(renditionKey("Ab3dEf9h", source, b));
    expect(deliveryEtag("Ab3dEf9h", source, a)).toBe(deliveryEtag("Ab3dEf9h", source, b));
    expect(renditionCacheUrl("https://img.gdgs.jp", renditionKey("Ab3dEf9h", source, a))).toBe(
      renditionCacheUrl("https://img.gdgs.jp", renditionKey("Ab3dEf9h", source, b)),
    );
  });

  it("has an exact stable key and etag shape", () => {
    const delivery = derive("w=1600");
    const key = renditionKey("Ab3dEf9h", source, delivery);
    expect(key).toBe("Ab3dEf9h/d/1735689600/1_w1600_scale-down_q82.avif");
    expect(deliveryEtag("Ab3dEf9h", source, delivery)).toBe(
      '"Ab3dEf9h-d-1735689600-w1600_scale-down_q82.avif"',
    );
    expect(renditionCacheUrl("https://img.gdgs.jp", key)).toBe(
      "https://img.gdgs.jp/_cache/Ab3dEf9h/d/1735689600/1_w1600_scale-down_q82.avif",
    );
    expect(isValidImageId(key)).toBe(false);
  });

  it("folds dpr into the same key, cache URL, and etag", () => {
    const withDpr = derive("w=800&dpr=2");
    const direct = derive("w=1600");
    expect(renditionKey("Ab3dEf9h", source, withDpr)).toBe(
      renditionKey("Ab3dEf9h", source, direct),
    );
    expect(deliveryEtag("Ab3dEf9h", source, withDpr)).toBe(
      deliveryEtag("Ab3dEf9h", source, direct),
    );
  });

  it("changes etags when negotiated output formats differ", () => {
    const avif = derive("w=1600");
    const jpeg = resolveDelivery({
      params: { w: 1600 },
      accept: "*/*",
      autoMaxWidth: 0,
      source: metadata,
    });
    expect(deliveryEtag("Ab3dEf9h", source, avif)).not.toBe(deliveryEtag("Ab3dEf9h", source, jpeg));
  });

  it("separates rounded renditions", () => {
    const small = derive("w=1600&radius=16");
    const large = derive("radius=24&w=1600");
    expect(renditionKey("Ab3dEf9h", source, small)).not.toBe(
      renditionKey("Ab3dEf9h", source, large),
    );
    expect(deliveryEtag("Ab3dEf9h", source, small)).not.toBe(
      deliveryEtag("Ab3dEf9h", source, large),
    );
  });

  it("separates variants and source versions", () => {
    const delivery = derive("w=1600");
    expect(renditionKey("Ab3dEf9h", source, delivery)).not.toBe(
      renditionKey("Ab3dEf9h", { variant: "m", sourceVersion: 1735689600 }, delivery),
    );
    expect(renditionKey("Ab3dEf9h", source, delivery)).not.toBe(
      renditionKey("Ab3dEf9h", { ...source, sourceVersion: 1735689601 }, delivery),
    );
  });
});
