export type TransformOpts = {
  w?: number;
  h?: number;
  dpr?: number;
  fit?: "scale-down" | "contain" | "cover" | "crop" | "pad";
  radius?: number;
  q?: number;
  f?: "auto" | "avif" | "webp" | "jpeg" | "png" | "original";
  variant?: "mobile";
};

export function deliveryUrl(id: string, opts: TransformOpts = {}): string {
  const params = new URLSearchParams();
  if (opts.w) params.set("w", String(opts.w));
  if (opts.h) params.set("h", String(opts.h));
  if (opts.dpr) params.set("dpr", String(opts.dpr));
  if (opts.fit) params.set("fit", opts.fit);
  if (opts.radius) params.set("radius", String(opts.radius));
  if (opts.q) params.set("q", String(opts.q));
  if (opts.f) params.set("f", opts.f);
  if (opts.variant) params.set("variant", opts.variant);
  const qs = params.toString();
  return qs ? `/${id}?${qs}` : `/${id}`;
}

export function parseTransformOpts(url: URL): TransformOpts {
  const opts: TransformOpts = {};
  const w = Number(url.searchParams.get("w"));
  const h = Number(url.searchParams.get("h"));
  if (Number.isFinite(w) && w > 0 && w <= 4096) opts.w = Math.floor(w);
  if (Number.isFinite(h) && h > 0 && h <= 4096) opts.h = Math.floor(h);
  const dpr = Number(url.searchParams.get("dpr"));
  if (Number.isFinite(dpr) && dpr > 0) opts.dpr = Math.min(3, Math.max(1, dpr));
  const fit = url.searchParams.get("fit");
  if (
    fit === "scale-down" ||
    fit === "contain" ||
    fit === "cover" ||
    fit === "crop" ||
    fit === "pad"
  ) {
    opts.fit = fit;
  }
  const radius = Number(url.searchParams.get("radius"));
  if (Number.isFinite(radius) && radius > 0) opts.radius = Math.min(2048, Math.floor(radius));
  const q = Number(url.searchParams.get("q"));
  if (Number.isFinite(q) && q >= 1 && q <= 100) opts.q = Math.floor(q);
  const f = url.searchParams.get("f");
  if (
    f === "auto" ||
    f === "avif" ||
    f === "webp" ||
    f === "jpeg" ||
    f === "png" ||
    f === "original"
  ) {
    opts.f = f;
  }
  if (url.searchParams.get("variant") === "mobile") opts.variant = "mobile";
  return opts;
}

export function hasTransform(opts: TransformOpts): boolean {
  // DPR is folded into explicit dimensions and has no effect by itself.
  return Boolean(opts.w || opts.h || opts.fit || opts.radius || opts.q || opts.f);
}
