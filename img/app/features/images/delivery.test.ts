import { describe, expect, it, vi } from "vitest";
import { type ResolvedDelivery, resolveDelivery } from "~/lib/img-transform";
import { deliverImage } from "./delivery.server";
import { renditionKey } from "./rendition-key";
import type { SourceVariant } from "./variant";

const source: SourceVariant = {
  r2Key: "Ab3dEf9h",
  contentType: "image/jpeg",
  byteSize: 20_000,
  width: 2000,
  height: 1000,
  variant: "d",
  sourceVersion: 123,
};

function delivery(params: Parameters<typeof resolveDelivery>[0]["params"] = { w: 1600 }) {
  return resolveDelivery({ params, accept: "image/avif", autoMaxWidth: 0, source });
}

function harness(
  options: {
    transformed?: Uint8Array;
    error?: Error & { code?: number };
    seeded?: { key: string; bytes?: Uint8Array; passthrough?: boolean };
  } = {},
) {
  const derived = new Map<string, { bytes: Uint8Array; passthrough: boolean }>();
  if (options.seeded) {
    derived.set(options.seeded.key, {
      bytes: options.seeded.bytes ?? new Uint8Array(),
      passthrough: options.seeded.passthrough ?? false,
    });
  }
  const puts: string[] = [];
  const input = vi.fn(() => ({
    transform: vi.fn().mockReturnThis(),
    draw: vi.fn().mockReturnThis(),
    output: vi.fn(() => {
      if (options.error) throw options.error;
      const bytes = options.transformed ?? new Uint8Array(50);
      return {
        response: () =>
          new Response(bytes.buffer as ArrayBuffer, {
            headers: { "Content-Type": "image/avif" },
          }),
      };
    }),
  }));
  const info = vi.fn(async () => ({
    format: "image/jpeg",
    fileSize: 20_000,
    width: 2000,
    height: 1000,
  }));
  const env = {
    ORIGINALS: {
      get: vi.fn(async () => ({ body: new Blob([new ArrayBuffer(20_000)]).stream() })),
    },
    DERIVED: {
      get: vi.fn(async (key: string) => {
        const value = derived.get(key);
        return value
          ? {
              body: new Blob([value.bytes.buffer as ArrayBuffer]).stream(),
              customMetadata: value.passthrough ? { passthrough: "1" } : {},
            }
          : null;
      }),
      put: vi.fn(async (key: string, value: ArrayBuffer, options?: R2PutOptions) => {
        puts.push(key);
        derived.set(key, {
          bytes: new Uint8Array(value),
          passthrough: options?.customMetadata?.passthrough === "1",
        });
      }),
    },
    IMAGES: { input, info },
  } as unknown as Env;
  const pending: Promise<unknown>[] = [];
  const ctx = {
    waitUntil: (promise: Promise<unknown>) => {
      pending.push(promise);
    },
  } as unknown as ExecutionContext;
  return { env, ctx, info, input, puts, flush: () => Promise.all(pending) };
}

async function run(
  testHarness: ReturnType<typeof harness>,
  resolved: ResolvedDelivery,
  automatic = false,
  sourceForRequest = source,
) {
  return deliverImage({
    env: testHarness.env,
    ctx: testHarness.ctx,
    id: "Ab3dEf9h",
    origin: "https://img.gdgs.jp",
    source: sourceForRequest,
    delivery: resolved,
    etag: '"etag"',
    automatic,
    cache: null,
  });
}

describe("deliverImage", () => {
  it("serves a stored rendition without invoking Images", async () => {
    const resolved = delivery();
    const key = renditionKey("Ab3dEf9h", source, resolved);
    const h = harness({ seeded: { key, bytes: new Uint8Array(30) } });
    expect((await (await run(h, resolved)).arrayBuffer()).byteLength).toBe(30);
    expect(h.input).not.toHaveBeenCalled();
  });

  it("transforms a canonical miss once and persists one object", async () => {
    const h = harness();
    const response = await run(h, delivery());
    await h.flush();
    expect(response.headers.get("content-type")).toBe("image/avif");
    expect(response.headers.get("content-length")).toBe("50");
    expect(h.input).toHaveBeenCalledTimes(1);
    expect(h.puts).toHaveLength(1);
  });

  it("transforms non-canonical requests without persisting them", async () => {
    const h = harness();
    await run(h, delivery({ w: 1600, q: 70 }));
    await h.flush();
    expect(h.input).toHaveBeenCalledTimes(1);
    expect(h.puts).toHaveLength(0);
  });

  it("draws four masks for rounded corners", async () => {
    const h = harness();
    await run(h, delivery({ w: 1600, radius: 24 }));
    const baseTransformer = h.input.mock.results[0]?.value;
    expect(baseTransformer.draw).toHaveBeenCalledTimes(4);
    expect(h.input).toHaveBeenCalledTimes(5);
    const maskInput = h.input.mock.calls.at(1) as unknown as
      | [ReadableStream<Uint8Array>]
      | undefined;
    if (!maskInput) throw new Error("Expected the first corner mask input");
    expect(
      Array.from(new Uint8Array(await new Response(maskInput[0]).arrayBuffer()).slice(0, 8)),
    ).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  });

  it("inspects an unknown source before rounding its corners", async () => {
    const unknownDimensions = { ...source, width: null, height: null };
    const resolved = resolveDelivery({
      params: { w: 1600, radius: 24 },
      accept: "image/avif",
      autoMaxWidth: 0,
      source: unknownDimensions,
    });
    const h = harness();
    await run(h, resolved, false, unknownDimensions);
    expect(h.info).toHaveBeenCalledTimes(1);
  });

  it("falls back to the original and marks permanent Images failures", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const error = Object.assign(new Error("not an image"), { code: 9412 });
    const h = harness({ error });
    const response = await run(h, delivery());
    await h.flush();
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/jpeg");
    expect(h.puts).toHaveLength(1);
  });

  it("does not mark transient Images failures", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const h = harness({ error: new Error("temporary") });
    expect((await run(h, delivery())).status).toBe(200);
    await h.flush();
    expect(h.puts).toHaveLength(0);
  });

  it("falls back and marks an automatic transform that is not smaller", async () => {
    const h = harness({ transformed: new Uint8Array(20_000) });
    const resolved = resolveDelivery({
      params: {},
      accept: "image/avif",
      autoMaxWidth: 1600,
      source,
    });
    const response = await run(h, resolved, true);
    await h.flush();
    expect(response.headers.get("content-type")).toBe("image/jpeg");
    expect(h.puts).toHaveLength(1);
  });
});
