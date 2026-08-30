import { deliverImage } from "~/features/images/delivery.server";
import { isValidImageId } from "~/features/images/id";
import { deliveryEtag } from "~/features/images/rendition-key";
import { getImage, getImageBySlug } from "~/features/images/repository";
import { selectSourceVariant } from "~/features/images/variant";
import { cacheHeaders, matchesEtag, notModified, varyHeader } from "~/lib/http-cache";
import { resolveDelivery } from "~/lib/img-transform";
import { hasTransform, parseTransformOpts } from "~/lib/img-url";
import type { Route } from "./+types/$id";

export async function loader(args: Route.LoaderArgs) {
  const param = args.params.id;
  const env = args.context.cloudflare.env;
  const image = isValidImageId(param)
    ? await getImage(env.DB, param)
    : await getImageBySlug(env.DB, param);
  if (!image) throw new Response("Not found", { status: 404 });

  const canonicalLink =
    param === image.id
      ? undefined
      : `<${env.APP_URL.replace(/\/$/, "")}/${image.id}>; rel="canonical"`;
  const url = new URL(args.request.url);
  const source = selectSourceVariant(image, url, args.request.headers);
  const params = parseTransformOpts(url);
  const delivery = resolveDelivery({
    params,
    accept: args.request.headers.get("accept") ?? "",
    autoMaxWidth: parseAutoMaxWidth(env.IMG_AUTO_MAX_WIDTH),
    source,
  });
  const etag = deliveryEtag(image.id, source, delivery);
  const vary = varyHeader(
    delivery.kind === "derive" && delivery.formatNegotiated,
    source.deviceVary,
  );
  const headers = cacheHeaders(etag);
  if (vary) headers.set("Vary", vary);
  if (canonicalLink) headers.set("Link", canonicalLink);
  if (matchesEtag(args.request.headers.get("if-none-match"), etag)) {
    return notModified(headers);
  }

  // Device detection can include User-Agent in Vary, which would fragment the
  // CDN cache almost per-client. deliverImage therefore uses a synthetic Cache
  // API key containing the fully resolved variant, source version and format.
  return deliverImage({
    env,
    ctx: args.context.cloudflare.ctx,
    id: image.id,
    origin: url.origin,
    source,
    delivery,
    etag,
    vary,
    canonicalLink,
    automatic: !hasTransform(params),
  });
}

function parseAutoMaxWidth(value: string): number {
  const width = Number(value);
  return Number.isFinite(width) && width > 0 ? Math.min(4096, Math.floor(width)) : 0;
}
