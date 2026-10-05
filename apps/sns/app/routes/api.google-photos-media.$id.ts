import { serveLibraryMedia } from "~/features/google-photos/media-response.server";
import type { Route } from "./+types/api.google-photos-media.$id";

export function loader({ request, context, params }: Route.LoaderArgs) {
  return serveLibraryMedia(request, context.cloudflare.env, params.id);
}
