import { data, redirect } from "react-router";
import { requireUserWithChapter } from "~/features/auth/auth-redirect.server";
import { requireDeck } from "~/features/deck/access.server";
import { createDeck, deleteDeck, renameDeck, rotateDockToken } from "~/features/deck/decks.server";
import { copyImages, deleteAllImages } from "~/features/deck/images.server";
import { cleanText, emptyLayout } from "~/features/deck/model";
import type { Route } from "./+types/api.decks";

export function loader() {
  return redirect("/");
}

const NAME_MAX = 60;

/** Deck mutations from the deck list and the editor (chapter members only). */
export async function action({ request, context }: Route.ActionArgs) {
  const env = context.cloudflare.env;
  const form = await request.formData();
  const intent = form.get("intent");

  if (intent === "create") {
    const { user, chapters } = await requireUserWithChapter(env, request);
    const name = cleanText(form.get("name"), NAME_MAX);
    if (!name) return data({ ok: false as const, error: "name" }, { status: 400 });
    const chapterId = Number(form.get("chapterId"));
    if (!chapters.some((c) => c.chapterId === chapterId)) {
      return data({ ok: false as const, error: "chapter" }, { status: 400 });
    }
    const deck = await createDeck(env.DB, {
      chapterId,
      name,
      layout: emptyLayout(Number(form.get("cols")), Number(form.get("rows"))),
      createdBy: user.id,
    });
    return redirect(`/decks/${deck.id}/edit`);
  }

  const { user, chapters, deck } = await requireDeck(env, request, form.get("deckId"));
  const room = env.DECK.getByName(deck.id);

  if (intent === "rename") {
    const name = cleanText(form.get("name"), NAME_MAX);
    if (!name) return data({ ok: false as const, error: "name" }, { status: 400 });
    await renameDeck(env.DB, deck.id, name);
    await room.layoutChanged(deck.id);
    return { ok: true as const };
  }
  if (intent === "duplicate") {
    // Into any chapter the user belongs to; the copy is independent of the original.
    const chapterId = Number(form.get("chapterId"));
    if (!chapters.some((c) => c.chapterId === chapterId)) {
      return data({ ok: false as const, error: "chapter" }, { status: 400 });
    }
    const name = cleanText(form.get("name"), NAME_MAX) || `${deck.name} のコピー`;
    const copy = await createDeck(env.DB, {
      chapterId,
      name,
      layout: deck.layout,
      createdBy: user.id,
    });
    await copyImages(env, deck.id, copy.id);
    return redirect(`/decks/${copy.id}/edit`);
  }
  if (intent === "rotate-dock") {
    await rotateDockToken(env.DB, deck.id);
    await room.revokeDock();
    return { ok: true as const };
  }
  if (intent === "delete") {
    await deleteAllImages(env, deck.id);
    await deleteDeck(env.DB, deck.id);
    await room.destroy();
    return redirect("/");
  }
  return data({ ok: false as const, error: "intent" }, { status: 400 });
}
