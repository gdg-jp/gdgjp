import { isValidImageId } from "~/lib/id";
import { getImage } from "~/lib/images";
import { hasTransform, parseTransformOpts } from "~/lib/img-url";
import type { Route } from "./+types/$id";

const CACHE_HEADERS = {
  "Cache-Control": "public, max-age=300, s-maxage=86400",
};

export async function loader(args: Route.LoaderArgs) {
  const id = args.params.id;
  if (!isValidImageId(id)) throw new Response("Not found", { status: 404 });
  const env = args.context.cloudflare.env;
  const image = await getImage(env.DB, id);
  if (!image) throw new Response("Not found", { status: 404 });

  const url = new URL(args.request.url);
  const etag = `"${id}-${image.updatedAt}"`;
  if (matchesEtag(args.request.headers.get("if-none-match"), etag)) {
    return new Response(null, { status: 304, headers: { ETag: etag, ...CACHE_HEADERS } });
  }

  const obj = await env.ORIGINALS.get(image.r2Key);
  if (!obj) throw new Response("Not found", { status: 404 });

  const opts = parseTransformOpts(url);
  if (!hasTransform(opts)) {
    return new Response(obj.body, {
      headers: {
        "Content-Type": image.contentType,
        "Content-Length": String(image.byteSize),
        ETag: etag,
        ...CACHE_HEADERS,
      },
    });
  }

  const transform: ImageTransform = {};
  if (opts.w) transform.width = opts.w;
  if (opts.h) transform.height = opts.h;
  if (opts.fit) transform.fit = opts.fit;

  const output: ImageOutputOptions = {
    format: formatFor(opts.f, args.request.headers.get("accept") || ""),
  };
  if (opts.q) output.quality = opts.q;

  const result = await env.IMAGES.input(obj.body).transform(transform).output(output);
  const res = result.response();
  const headers = new Headers(res.headers);
  headers.set("ETag", etag);
  for (const [k, v] of Object.entries(CACHE_HEADERS)) headers.set(k, v);
  if (!opts.f) headers.set("Vary", "Accept");
  return new Response(res.body, { status: res.status, headers });
}

function matchesEtag(header: string | null, etag: string): boolean {
  if (!header) return false;
  for (const raw of header.split(",")) {
    let token = raw.trim();
    if (token === "*") return true;
    if (token.startsWith("W/")) token = token.slice(2);
    if (token === etag) return true;
  }
  return false;
}

function formatFor(explicit: string | undefined, accept: string): ImageOutputOptions["format"] {
  if (explicit === "avif") return "image/avif";
  if (explicit === "webp") return "image/webp";
  if (explicit === "jpeg") return "image/jpeg";
  if (explicit === "png") return "image/png";
  if (accept.includes("image/avif")) return "image/avif";
  if (accept.includes("image/webp")) return "image/webp";
  return "image/jpeg";
}
