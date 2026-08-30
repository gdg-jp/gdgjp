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
      const rounding = resolveCornerRounding(
        input.delivery.transform.radius,
        input.delivery.transform,
        roundedSource.source,
      );
      if (rounding.circleSize !== undefined) {
        transformer = transformer.transform({
          width: rounding.circleSize,
          height: rounding.circleSize,
          fit: "cover",
        });
      }
      if (rounding.radius > 0) {
        transformer = drawRoundedCorners(input.env.IMAGES, transformer, rounding.radius);
      }
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

function resolveCornerRounding(
  requested: number,
  transform: { width?: number; height?: number; fit: ImageTransform["fit"] },
  source: Pick<SourceVariant, "width" | "height">,
): { radius: number; circleSize?: number } {
  const dimensions = outputDimensions(transform, source);
  if (dimensions === null) return { radius: requested };

  const circleSize = Math.min(dimensions.width, dimensions.height);
  const radius = Math.min(requested, Math.floor(circleSize / 2));
  return {
    radius,
    ...(requested >= circleSize / 2 && dimensions.width !== dimensions.height
      ? { circleSize }
      : {}),
  };
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
