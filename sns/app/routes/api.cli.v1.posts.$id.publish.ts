import { requireCliSnsAccess } from "~/features/auth/cli-access.server";
import { getPost } from "~/features/posts/post.repository.server";
import { publishNow } from "~/features/posts/publish-now.service.server";
import { cliAccessErrorAsNotFound } from "~/lib/cli-errors.server";
import { cliError, cliJson, cliMethodNotAllowed } from "~/lib/cli-http.server";
import type { Route } from "./+types/api.cli.v1.posts.$id.publish";

// Action-only route: a GET/HEAD never reaches `action`, so answer it here with
// the same JSON 405 the HTTP boundary promises.
export function loader(_args: Route.LoaderArgs) {
  return cliMethodNotAllowed();
}

export async function action(args: Route.ActionArgs) {
  if (args.request.method !== "POST") return cliMethodNotAllowed();
  const env = args.context.cloudflare.env;
  const id = args.params.id ?? "";

  const post = await getPost(env.DB, id);
  if (!post) return cliError("not_found", 404);

  const access = await requireCliSnsAccess(args.request, env, post.chapterId);
  if ("error" in access) return cliAccessErrorAsNotFound(access.error);

  const result = await publishNow(env, id, access.user);
  switch (result.outcome) {
    case "published":
      return cliJson({ post: result.post });
    case "x_failed":
      // The post is persisted as `failed`/`needs_confirmation`; hand it back so
      // a script can read `failureReason` rather than only seeing a 502.
      return cliJson({ post: result.post }, { status: 502 });
    case "not_found":
      return cliError("not_found", 404);
    case "conflict":
      return cliError(result.code, 409);
  }
}
