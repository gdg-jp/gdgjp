import { UPLOAD_ID_RE } from "~/features/clips/clip-input";
import { audioKey } from "~/features/clips/uploads.server";
import type { Route } from "./+types/media.$id";

export async function loader({ request, params, context }: Route.LoaderArgs) {
  if (!UPLOAD_ID_RE.test(params.id)) return new Response("not found", { status: 404 });
  const bucket = context.cloudflare.env.AUDIO;
  const object = await bucket.get(audioKey(params.id), { range: request.headers });
  if (!object) return new Response("not found", { status: 404 });

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  headers.set("accept-ranges", "bytes");
  headers.set("cache-control", "public, max-age=31536000, immutable");

  const range = object.range as { offset?: number; length?: number } | undefined;
  if (request.headers.has("range") && range && "offset" in range) {
    const offset = range.offset ?? 0;
    const length = range.length ?? object.size - offset;
    headers.set("content-range", `bytes ${offset}-${offset + length - 1}/${object.size}`);
    headers.set("content-length", String(length));
    return new Response(object.body, { status: 206, headers });
  }
  headers.set("content-length", String(object.size));
  return new Response(object.body, { headers });
}
