import { serveImage } from "~/features/images/serve.server";
import type { Route } from "./+types/serve";

export function loader({ context, request, params }: Route.LoaderArgs) {
  return serveImage(context.cloudflare.env, context.cloudflare.ctx, request, params.id);
}
