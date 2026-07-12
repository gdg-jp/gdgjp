export type TransformOpts = {
  w?: number;
  h?: number;
  fit?: "scale-down" | "contain" | "cover" | "crop" | "pad";
  q?: number;
  f?: "auto" | "avif" | "webp" | "jpeg" | "png";
  variant?: "mobile";
};

export function deliveryUrl(id: string, opts: TransformOpts = {}): string {
  const params = new URLSearchParams();
  if (opts.w) params.set("w", String(opts.w));
  if (opts.h) params.set("h", String(opts.h));
  if (opts.fit) params.set("fit", opts.fit);
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
  const q = Number(url.searchParams.get("q"));
  if (Number.isFinite(q) && q >= 1 && q <= 100) opts.q = Math.floor(q);
  const f = url.searchParams.get("f");
  if (f === "auto" || f === "avif" || f === "webp" || f === "jpeg" || f === "png") {
    opts.f = f;
  }
  return opts;
}

export function hasTransform(opts: TransformOpts): boolean {
  return Boolean(opts.w || opts.h || opts.fit || opts.q || opts.f);
}
