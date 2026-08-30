import { cacheHeaders, cachePut } from "~/lib/http-cache";
import type { ResolvedDelivery } from "~/lib/img-transform";
import { renditionCacheUrl, renditionKey } from "./rendition-key";
import { getRendition, putPassthroughMarker, putRendition } from "./rendition-store";
import type { SourceVariant } from "./variant";

type DeliveryCache = Pick<Cache, "match" | "put">;

// Cloudflare Images supports raster overlay inputs. This transparent PNG is an
// opaque quarter-circle exterior; with `xor`, it removes one image corner.
// Keeping it in source avoids another public asset or an R2 read per request.
const CORNER_MASK_PNG =
  "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";

export async function deliverImage(input: {
  env: Env;
  ctx: ExecutionContext;
  id: string;
  origin: string;
  source: SourceVariant;
  delivery: ResolvedDelivery;
  etag: string;
  vary?: string;
  canonicalLink?: string;
  automatic: boolean;
  cache?: DeliveryCache | null;
}): Promise<Response> {
  const cache = input.cache === undefined ? defaultCache() : input.cache;
  if (input.delivery.kind === "passthrough") return originalResponse(input);

  const key = renditionKey(input.id, input.source, input.delivery);
  const cacheKey = new Request(renditionCacheUrl(input.origin, key));
  try {
    const cached = await cache?.match(cacheKey);
    if (cached) return derivedResponse(cached.body, input, input.delivery.transform.format);

    const stored = await getRendition(input.env, key);
    if (stored?.customMetadata?.passthrough === "1") return originalResponse(input);
    if (stored) {
      const response = derivedResponse(stored.body, input, input.delivery.transform.format);
      input.ctx.waitUntil(cachePut(cache, cacheKey, response));
      return response;
    }

    const original = await input.env.ORIGINALS.get(input.source.r2Key);
    if (!original) throw new Response("Not found", { status: 404 });
    const roundedSource =
      input.delivery.transform.radius === undefined
        ? { body: original.body, source: input.source }
        : await sourceForRoundedCorners(input.env.IMAGES, original.body, input.source);
    let transformer = input.env.IMAGES.input(roundedSource.body).transform(
      toImageTransform(input.delivery.transform),
    );
    if (input.delivery.transform.radius !== undefined) {
      const radius = safeCornerRadius(
        input.delivery.transform.radius,
        input.delivery.transform,
        roundedSource.source,
      );
      if (radius > 0) transformer = drawRoundedCorners(input.env.IMAGES, transformer, radius);
    }
    const transformed = await transformer.output({
      format: `image/${input.delivery.transform.format}` as ImageOutputOptions["format"],
      quality: input.delivery.transform.quality,
    });
    const transformedResponse = transformed.response();
    if (!transformedResponse.ok) throw new Error(`Images returned ${transformedResponse.status}`);
    const bytes = await transformedResponse.arrayBuffer();

    if (input.automatic && bytes.byteLength >= input.source.byteSize) {
      input.ctx.waitUntil(putPassthroughMarker(input.env, key));
      return originalResponse(input);
    }

    const response = derivedResponse(bytes, input, input.delivery.transform.format);
    input.ctx.waitUntil(
      Promise.all([
        input.delivery.canonical
          ? putRendition(input.env, key, bytes, input.delivery.transform)
          : Promise.resolve(),
        cachePut(cache, cacheKey, response),
      ]),
    );
    return response;
  } catch (error) {
    if (error instanceof Response) throw error;
    console.error("Image derivation failed; serving the original", error);

    // Only permanent input failures get a durable marker. Transient binding or
    // network failures must be retried, or one brief outage would pin a public
    // URL to its unoptimized bytes indefinitely. Non-canonical explicit keys
    // are excluded so arbitrary query combinations cannot fill DERIVED.
    if (isPermanentImagesError(error) && (input.automatic || input.delivery.canonical)) {
      input.ctx.waitUntil(putPassthroughMarker(input.env, key));
    }
    return originalResponse(input);
  }
}

async function originalResponse(input: {
  env: Env;
  source: SourceVariant;
  etag: string;
  vary?: string;
  canonicalLink?: string;
}): Promise<Response> {
  const object = await input.env.ORIGINALS.get(input.source.r2Key);
  if (!object) throw new Response("Not found", { status: 404 });
  const headers = responseHeaders(input, input.source.contentType);
  headers.set("Content-Length", String(input.source.byteSize));
  return new Response(object.body, { headers });
}

function derivedResponse(
  body: BodyInit | null,
  input: { etag: string; vary?: string; canonicalLink?: string },
  format: string,
): Response {
  const headers = responseHeaders(input, `image/${format}`);
  if (body instanceof ArrayBuffer) headers.set("Content-Length", String(body.byteLength));
  return new Response(body, { headers });
}

function responseHeaders(
  input: { etag: string; vary?: string; canonicalLink?: string },
  contentType: string,
): Headers {
  const headers = cacheHeaders(input.etag, { "Content-Type": contentType });
  if (input.vary) headers.set("Vary", input.vary);
  if (input.canonicalLink) headers.set("Link", input.canonicalLink);
  return headers;
}

function toImageTransform(transform: {
  width?: number;
  height?: number;
  fit: ImageTransform["fit"];
}): ImageTransform {
  return {
    ...(transform.width === undefined ? {} : { width: transform.width }),
    ...(transform.height === undefined ? {} : { height: transform.height }),
    fit: transform.fit,
  };
}

function drawRoundedCorners(images: ImagesBinding, image: ImageTransformer, radius: number) {
  const mask = cornerMask();
  const [firstPair, topRight] = mask.tee();
  const [secondPair, bottomLeft] = firstPair.tee();
  const [topLeft, bottomRight] = secondPair.tee();

  return image
    .draw(images.input(topLeft).transform({ width: radius }), {
      left: 0,
      top: 0,
      composite: "xor",
    })
    .draw(images.input(topRight).transform({ width: radius, rotate: 90 }), {
      right: 0,
      top: 0,
      composite: "xor",
    })
    .draw(images.input(bottomRight).transform({ width: radius, rotate: 180 }), {
      bottom: 0,
      right: 0,
      composite: "xor",
    })
    .draw(images.input(bottomLeft).transform({ width: radius, rotate: 270 }), {
      bottom: 0,
      left: 0,
      composite: "xor",
    });
}

function cornerMask(): ReadableStream<Uint8Array> {
  const binary = atob(CORNER_MASK_PNG);
  return new Blob([Uint8Array.from(binary, (char) => char.charCodeAt(0))], {
    type: "image/png",
  }).stream();
}

function safeCornerRadius(
  requested: number,
  transform: { width?: number; height?: number; fit: ImageTransform["fit"] },
  source: Pick<SourceVariant, "width" | "height">,
): number {
  const dimensions = outputDimensions(transform, source);
  return dimensions === null
    ? requested
    : Math.min(requested, Math.floor(Math.min(dimensions.width, dimensions.height) / 2));
}

function outputDimensions(
  transform: { width?: number; height?: number; fit: ImageTransform["fit"] },
  source: Pick<SourceVariant, "width" | "height">,
): { width: number; height: number } | null {
  if (source.width === null || source.height === null) return null;
  const { width: sourceWidth, height: sourceHeight } = source;
  const { width, height } = transform;
  if (width === undefined && height === undefined)
    return { width: sourceWidth, height: sourceHeight };

  if (width !== undefined && height !== undefined) {
    if (transform.fit === "cover" || transform.fit === "pad") return { width, height };
    if (transform.fit === "crop") {
      return { width: Math.min(width, sourceWidth), height: Math.min(height, sourceHeight) };
    }
    const scale = Math.min(width / sourceWidth, height / sourceHeight);
    const boundedScale = transform.fit === "scale-down" ? Math.min(1, scale) : scale;
    return {
      width: Math.max(1, Math.round(sourceWidth * boundedScale)),
      height: Math.max(1, Math.round(sourceHeight * boundedScale)),
    };
  }

  if (width !== undefined) {
    const scale =
      transform.fit === "scale-down" ? Math.min(1, width / sourceWidth) : width / sourceWidth;
    return {
      width: Math.max(1, Math.round(sourceWidth * scale)),
      height: Math.max(1, Math.round(sourceHeight * scale)),
    };
  }

  if (height === undefined) return { width: sourceWidth, height: sourceHeight };
  const scale =
    transform.fit === "scale-down" ? Math.min(1, height / sourceHeight) : height / sourceHeight;
  return {
    width: Math.max(1, Math.round(sourceWidth * scale)),
    height: Math.max(1, Math.round(sourceHeight * scale)),
  };
}

async function sourceForRoundedCorners(
  images: ImagesBinding,
  body: ReadableStream<Uint8Array>,
  source: SourceVariant,
): Promise<{ body: ReadableStream<Uint8Array>; source: SourceVariant }> {
  if (source.width !== null && source.height !== null) return { body, source };
  const [infoBody, imageBody] = body.tee();
  try {
    const info = await images.info(infoBody);
    if ("width" in info) {
      return { body: imageBody, source: { ...source, width: info.width, height: info.height } };
    }
  } catch (error) {
    console.warn("Could not inspect image dimensions for rounded corners", error);
  }
  return { body: imageBody, source };
}

function isPermanentImagesError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === 9412;
}

function defaultCache(): Cache | null {
  return typeof caches === "undefined"
    ? null
    : (caches as CacheStorage & { default: Cache }).default;
}
