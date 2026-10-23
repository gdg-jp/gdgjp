import type { AuthUser } from "@gdgjp/gdg-lib";
import { data } from "react-router";
import { requireUserWithChapter } from "~/features/auth/auth-redirect.server";
import { getAuth } from "~/features/auth/auth.server";
import {
  ClaimsUnavailableError,
  type UserChapter,
  fetchChaptersForUser,
} from "~/features/auth/chapter.server";
import { type DeckRow, getDeck, isDeckId } from "./decks.server";

export type DeckAccess = { user: AuthUser; chapters: UserChapter[]; deck: DeckRow };

/** A signed-in member of the chapter that owns the deck; 404 otherwise (no existence leak). */
export async function requireDeck(
  env: Env,
  request: Request,
  deckId: unknown,
): Promise<DeckAccess> {
  const { user, chapters } = await requireUserWithChapter(env, request);
  const deck = isDeckId(deckId) ? await getDeck(env.DB, deckId) : null;
  if (!deck || !chapters.some((c) => c.chapterId === deck.chapterId)) {
    throw data("deck not found", { status: 404 });
  }
  return { user, chapters, deck };
}

/**
 * Non-throwing gate for the controller WebSocket upgrade. A signed session is
 * mandatory; if the IdP is briefly unreachable, an already signed-in member
 * may still reconnect mid-event (the page load itself checked membership).
 */
export async function canUseDeck(
  env: Env,
  request: Request,
  chapterId: number,
): Promise<{ ok: boolean; name: string }> {
  let user: AuthUser | null;
  try {
    user = await getAuth(env).getSessionUser(request);
  } catch (e) {
    return { ok: e instanceof Response && e.status === 503, name: "" };
  }
  if (!user) return { ok: false, name: "" };
  try {
    const { all } = await fetchChaptersForUser(env, request);
    return { ok: all.some((c) => c.chapterId === chapterId), name: user.name };
  } catch (err) {
    return { ok: !(err instanceof ClaimsUnavailableError), name: user.name };
  }
}
