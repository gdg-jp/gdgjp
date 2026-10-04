import type { TransformOpts } from "./img-url";

export const SCHEMA_VERSION = 1;
export const WIDTH_LADDER = [160, 320, 480, 640, 768, 960, 1200, 1600, 2048, 2560, 3200, 4096];
export const DEFAULT_QUALITY = 82;
export const DEFAULT_FIT = "scale-down";
export const MIN_TRANSFORM_BYTES = 10 * 1024;
export const MAX_DPR = 3;
const RADIUS_RENDITION_VERSION = 4;

export type Fit = "scale-down" | "contain" | "cover" | "crop" | "pad";
export type DeriveTransform = {
  width?: number;
  height?: number;
  fit: Fit;
  radius?: number;
  quality: number;
  format: "avif" | "webp" | "jpeg" | "png";
};
export type ResolvedDelivery =
  | { kind: "passthrough"; reason: "explicit-original" | "svg" | "animated" | "too-small" }
  | {
      kind: "derive";
      transform: DeriveTransform;
      canonical: boolean;
      formatNegotiated: boolean;
    };

export function negotiateFormat(
  accept: string,
  sourceContentType: string,
  requiresAlpha = false,
): DeriveTransform["format"] {
  if (sourceContentType !== "image/gif" && accept.includes("image/avif")) return "avif";
  if (accept.includes("image/webp")) return "webp";
  if (requiresAlpha) return "png";
  return sourceContentType === "image/png" ? "png" : "jpeg";
}

export function snapWidth(requested: number): number {
  return WIDTH_LADDER.find((width) => width >= requested) ?? 4096;
}

export function renditionParamSlug(transform: DeriveTransform): string {
  const height = transform.height === undefined ? "" : `_h${transform.height}`;
  const radius =
    transform.radius === undefined ? "" : `_r${RADIUS_RENDITION_VERSION}-${transform.radius}`;
  return `w${transform.width ?? 0}${height}_${transform.fit}${radius}_q${transform.quality}`;
}

export function isCanonical(transform: DeriveTransform): boolean {
  return (
    transform.fit === DEFAULT_FIT &&
    transform.quality === DEFAULT_QUALITY &&
    transform.radius === undefined &&
    transform.height === undefined &&
    transform.width !== undefined &&
    WIDTH_LADDER.includes(transform.width)
  );
}

export function resolveDelivery(input: {
  params: TransformOpts;
  accept: string;
  autoMaxWidth: number;
  source: {
    contentType: string;
    byteSize: number;
    width: number | null;
    height: number | null;
  };
}): ResolvedDelivery {
  const { params, source } = input;
  if (params.f === "original") return { kind: "passthrough", reason: "explicit-original" };
  if (source.contentType === "image/svg+xml") return { kind: "passthrough", reason: "svg" };

  const explicit = Boolean(
    params.w || params.h || params.fit || params.radius || params.q || params.f,
  );
  if (source.contentType === "image/gif" && (!isConcreteFormat(params.f) || params.f === "avif")) {
    return { kind: "passthrough", reason: "animated" };
  }
  if (!explicit && source.byteSize < MIN_TRANSFORM_BYTES) {
    return { kind: "passthrough", reason: "too-small" };
  }

  const dpr = Math.min(MAX_DPR, Math.max(1, params.dpr ?? 1));
  const requestedWidth = params.w
    ? snapWidth(Math.round(params.w * dpr))
    : input.autoMaxWidth > 0
      ? snapWidth(input.autoMaxWidth)
      : undefined;
  let width = requestedWidth;
  if (width !== undefined && source.width !== null) width = Math.min(width, source.width);
  if (!params.w && source.width !== null && width !== undefined && source.width <= width) {
    width = undefined;
  }
  const height = params.h ? Math.min(4096, Math.round(params.h * dpr)) : undefined;
  const formatNegotiated = !isConcreteFormat(params.f);
  const transform: DeriveTransform = {
    ...(width === undefined ? {} : { width }),
    ...(height === undefined ? {} : { height }),
    fit: params.fit ?? DEFAULT_FIT,
    ...(params.radius === undefined ? {} : { radius: params.radius }),
    quality: params.q ?? DEFAULT_QUALITY,
    format:
      params.radius !== undefined && params.f === "jpeg"
        ? "png"
        : isConcreteFormat(params.f)
          ? params.f
          : negotiateFormat(input.accept, source.contentType, params.radius !== undefined),
  };
  return { kind: "derive", transform, canonical: isCanonical(transform), formatNegotiated };
}

function isConcreteFormat(format: TransformOpts["f"]): format is DeriveTransform["format"] {
  return format === "avif" || format === "webp" || format === "jpeg" || format === "png";
}
