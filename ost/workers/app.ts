import { createRequestHandler } from "react-router";
import { normalizeSlug } from "../app/lib/slug";

const requestHandler = createRequestHandler(
  () => import("virtual:react-router/server-build"),
  import.meta.env?.MODE ?? "production",
);

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === "/ws" && request.headers.get("Upgrade")?.toLowerCase() === "websocket") {
      const slug = url.searchParams.get("board");
      if (!slug || normalizeSlug(slug) !== slug) {
        return new Response("bad board", { status: 400 });
      }
      return env.OST_BOARD.getByName(slug).fetch(request);
    }
    return requestHandler(request, { cloudflare: { env, ctx } });
  },
} satisfies ExportedHandler<Env>;

export { OstBoard } from "./ost-board";
