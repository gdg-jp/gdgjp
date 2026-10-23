import { data } from "react-router";
import { requireDeck } from "~/features/deck/access.server";
import { saveLayout } from "~/features/deck/decks.server";
import { pruneImages } from "~/features/deck/images.server";
import { imageIds, parseLayout } from "~/features/deck/model";
import type { Route } from "./+types/api.decks.$deckId.layout";

/**
 * Saves the whole layout (JSON body `{ version, layout }`). A save based on an
 * older version than the stored one is refused with 409 so two editors never
 * silently overwrite each other.
 */
export async function action({ request, params, context }: Route.ActionArgs) {
  const env = context.cloudflare.env;
  const { deck } = await requireDeck(env, request, params.deckId);
  const body = (await request.json().catch(() => null)) as {
    version?: unknown;
    layout?: unknown;
  } | null;
  const layout = parseLayout(body?.layout);
  const version = Number(body?.version);
  if (!layout || !Number.isInteger(version)) {
    return data({ ok: false as const, error: "invalid" }, { status: 400 });
  }
  const result = await saveLayout(env.DB, deck.id, version, layout);
  if (!result.ok) {
    return data(
      { ok: false as const, error: result.error },
      { status: result.error === "conflict" ? 409 : 413 },
    );
  }
  await env.DECK.getByName(deck.id).layoutChanged(deck.id);
  context.cloudflare.ctx.waitUntil(pruneImages(env, deck.id, imageIds(layout)));
  return { ok: true as const, version: result.version };
}
