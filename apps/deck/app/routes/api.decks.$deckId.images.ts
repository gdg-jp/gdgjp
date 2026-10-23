import { data } from "react-router";
import { requireDeck } from "~/features/deck/access.server";
import { uploadImage } from "~/features/deck/images.server";
import type { Route } from "./+types/api.decks.$deckId.images";

/** Key image upload (multipart `file`): PNG / JPEG / WebP up to 1 MB. */
export async function action({ request, params, context }: Route.ActionArgs) {
  const env = context.cloudflare.env;
  const { deck } = await requireDeck(env, request, params.deckId);
  const file = (await request.formData()).get("file");
  if (!(file instanceof File)) return data({ ok: false as const, error: "file" }, { status: 400 });
  const result = await uploadImage(env, deck.id, file);
  if (!result.ok) return data(result, { status: result.error === "size" ? 413 : 415 });
  return result;
}
