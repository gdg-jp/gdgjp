import { servePostMedia } from "~/features/posts/media-response.server";
import type { Route } from "./+types/api.media.$id";

export function loader({ request, context, params }: Route.LoaderArgs) {
  return servePostMedia(request, context.cloudflare.env, params.id);
}
