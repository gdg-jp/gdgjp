import { requireDeck } from "~/features/deck/access.server";
import { getImage } from "~/features/deck/images.server";
import type { Route } from "./+types/images.$deckId.$imageId";

const IMAGE_ID_RE = /^[A-Za-z0-9_-]{1,40}$/;

/** A key image, for members of the deck's chapter. Ids are never reused, so it caches for good. */
export async function loader({ request, params, context }: Route.LoaderArgs) {
  const env = context.cloudflare.env;
  const { deck } = await requireDeck(env, request, params.deckId);
  if (!IMAGE_ID_RE.test(params.imageId)) return new Response("not found", { status: 404 });
  const obj = await getImage(env, deck.id, params.imageId);
  if (!obj) return new Response("not found", { status: 404 });
  return new Response(obj.body, {
    headers: {
      "Content-Type": obj.httpMetadata?.contentType ?? "application/octet-stream",
      "Cache-Control": "private, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
