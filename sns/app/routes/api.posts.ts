import { updatePostMedia } from "~/features/posts/post-media-command.server";
import type { Route } from "./+types/api.posts";

export function action({ request, context }: Route.ActionArgs) {
  return updatePostMedia(request, context.cloudflare.env);
}
