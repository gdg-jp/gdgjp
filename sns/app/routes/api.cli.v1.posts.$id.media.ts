import { requireCliSnsAccess } from "~/features/auth/cli-access.server";
import { postDraftDepsFromEnv } from "~/features/posts/post-draft.deps.server";
import { PostDraftError, attachMedia } from "~/features/posts/post-draft.service.server";
import { getPost } from "~/features/posts/post.repository.server";
import { cliAccessErrorAsNotFound, postDraftErrorResponse } from "~/lib/cli-errors.server";
import { cliError, cliJson, cliMethodNotAllowed } from "~/lib/cli-http.server";
import type { Route } from "./+types/api.cli.v1.posts.$id.media";

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

  let form: FormData;
  try {
    form = await args.request.formData();
  } catch {
    return cliError("invalid_request", 400);
  }

  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) return cliError("invalid_request", 400);

  const sortOrder = Number(form.get("sortOrder"));
  if (!Number.isInteger(sortOrder) || sortOrder < 0) return cliError("invalid_request", 400);

  const altTextRaw = form.get("altText");
  const altText = typeof altTextRaw === "string" ? altTextRaw : undefined;

  try {
    const result = await attachMedia(postDraftDepsFromEnv(env), id, {
      bytes: await file.arrayBuffer(),
      contentType: file.type,
      sortOrder,
      ...(altText !== undefined ? { altText } : {}),
    });
    return cliJson({ media: result.media, post: result.post }, { status: 201 });
  } catch (error) {
    if (error instanceof PostDraftError) return postDraftErrorResponse(error);
    throw error;
  }
}
