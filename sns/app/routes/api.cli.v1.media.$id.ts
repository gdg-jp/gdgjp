import { requireCliSnsAccess } from "~/features/auth/cli-access.server";
import { postDraftDepsFromEnv } from "~/features/posts/post-draft.deps.server";
import { PostDraftError, removeMedia } from "~/features/posts/post-draft.service.server";
import { getPostMediaById } from "~/features/posts/post-media.repository.server";
import { getPost } from "~/features/posts/post.repository.server";
import { cliAccessErrorAsNotFound, postDraftErrorResponse } from "~/lib/cli-errors.server";
import { cliError, cliJson, cliMethodNotAllowed } from "~/lib/cli-http.server";
import type { Route } from "./+types/api.cli.v1.media.$id";

// Action-only route: a GET/HEAD never reaches `action`, so answer it here with
// the same JSON 405 the HTTP boundary promises.
export function loader(_args: Route.LoaderArgs) {
  return cliMethodNotAllowed();
}

export async function action(args: Route.ActionArgs) {
  if (args.request.method !== "DELETE") return cliMethodNotAllowed();
  const env = args.context.cloudflare.env;
  const id = args.params.id ?? "";

  // Authorize by the owning post's chapter — never a caller-supplied id.
  const media = await getPostMediaById(env.DB, id);
  if (!media) return cliError("not_found", 404);
  const post = await getPost(env.DB, media.postId);
  if (!post) return cliError("not_found", 404);

  const access = await requireCliSnsAccess(args.request, env, post.chapterId);
  if ("error" in access) return cliAccessErrorAsNotFound(access.error);

  try {
    const result = await removeMedia(postDraftDepsFromEnv(env), id);
    return cliJson({ id: result.id, deleted: true, post: result.post });
  } catch (error) {
    if (error instanceof PostDraftError) return postDraftErrorResponse(error);
    throw error;
  }
}
