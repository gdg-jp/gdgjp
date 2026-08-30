import { cacheHeaders, cachePut } from "~/lib/http-cache";
import type { ResolvedDelivery } from "~/lib/img-transform";
import { renditionCacheUrl, renditionKey } from "./rendition-key";
import { getRendition, putPassthroughMarker, putRendition } from "./rendition-store";
import type { SourceVariant } from "./variant";

type DeliveryCache = Pick<Cache, "match" | "put">;

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
  const mask = cornerMask(radius);
  const [firstPair, topRight] = mask.tee();
  const [secondPair, bottomLeft] = firstPair.tee();
  const [topLeft, bottomRight] = secondPair.tee();

  return image
    .draw(images.input(topLeft), { left: 0, top: 0, composite: "xor" })
    .draw(images.input(topRight).transform({ rotate: 90 }), {
      right: 0,
      top: 0,
      composite: "xor",
    })
    .draw(images.input(bottomRight).transform({ rotate: 180 }), {
      bottom: 0,
      right: 0,
      composite: "xor",
    })
    .draw(images.input(bottomLeft).transform({ rotate: 270 }), {
      bottom: 0,
      left: 0,
      composite: "xor",
    });
}

function cornerMask(radius: number): ReadableStream<Uint8Array> {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${radius}" height="${radius}" viewBox="0 0 ${radius} ${radius}"><path d="M0 0H${radius}A${radius} ${radius} 0 0 0 0 ${radius}Z"/></svg>`;
  return new Blob([svg], { type: "image/svg+xml" }).stream();
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
