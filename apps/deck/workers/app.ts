import { createRequestHandler } from "react-router";
import { canUseDeck } from "../app/features/deck/access.server";
import { getDeck, isDeckId, timingSafeEqual } from "../app/features/deck/decks.server";
import type { DeckInfo } from "../app/features/room/protocol";
import { ROOM_HEADERS } from "./deck-room";

const requestHandler = createRequestHandler(
  () => import("virtual:react-router/server-build"),
  import.meta.env?.MODE ?? "production",
);

const PEER_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;

/**
 * `/ws?deck=<id>&role=controller&pid=<tab>` (session cookie, chapter member of
 * the deck's chapter) or `/ws?deck=<id>&role=dock&t=<dock token>` (OBS dock).
 */
async function handleSocket(request: Request, env: Env, url: URL): Promise<Response> {
  const deckId = url.searchParams.get("deck");
  if (!isDeckId(deckId)) return new Response("bad deck", { status: 400 });
  const deck = await getDeck(env.DB, deckId);
  if (!deck) return new Response("no deck", { status: 404 });
  const role = url.searchParams.get("role");
  const headers = new Headers(request.headers);

  if (role === "dock") {
    if (!timingSafeEqual(url.searchParams.get("t") ?? "", deck.dockToken)) {
      return new Response("bad token", { status: 403 });
    }
    headers.set(ROOM_HEADERS.peerId, "dock");
    headers.set(ROOM_HEADERS.name, "dock");
  } else if (role === "controller") {
    const gate = await canUseDeck(env, request, deck.chapterId);
    if (!gate.ok) return new Response("unauthorized", { status: 401 });
    const tab = url.searchParams.get("pid") ?? "";
    if (!PEER_ID_RE.test(tab)) return new Response("bad pid", { status: 400 });
    headers.set(ROOM_HEADERS.peerId, tab);
    headers.set(ROOM_HEADERS.name, encodeURIComponent(gate.name || "操作者"));
  } else {
    return new Response("bad role", { status: 400 });
  }

  const info: DeckInfo = { id: deck.id, name: deck.name, version: deck.version };
  headers.set(ROOM_HEADERS.role, role);
  headers.set(ROOM_HEADERS.deck, encodeURIComponent(JSON.stringify(info)));
  return env.DECK.getByName(deck.id).fetch(new Request(request.url, { headers }));
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === "/ws" && request.headers.get("Upgrade")?.toLowerCase() === "websocket") {
      return handleSocket(request, env, url);
    }
    return requestHandler(request, { cloudflare: { env, ctx } });
  },
} satisfies ExportedHandler<Env>;

export { DeckRoom } from "./deck-room";
