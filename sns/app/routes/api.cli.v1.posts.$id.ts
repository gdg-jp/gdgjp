import { requireCliSnsAccess } from "~/features/auth/cli-access.server";
import { postDraftDepsFromEnv } from "~/features/posts/post-draft.deps.server";
import {
  PostDraftError,
  deleteDraft,
  getDraft,
  updateDraft,
} from "~/features/posts/post-draft.service.server";
import { getPost } from "~/features/posts/post.repository.server";
import { cliAccessErrorAsNotFound, postDraftErrorResponse } from "~/lib/cli-errors.server";
import { cliError, cliJson, cliMethodNotAllowed, parseCliJsonBody } from "~/lib/cli-http.server";
import type { Route } from "./+types/api.cli.v1.posts.$id";

export async function loader(args: Route.LoaderArgs) {
  const env = args.context.cloudflare.env;
  const detail = await getDraft(postDraftDepsFromEnv(env), args.params.id ?? "");
  if (!detail) return cliError("not_found", 404);

  const access = await requireCliSnsAccess(args.request, env, detail.post.chapterId);
  if ("error" in access) return cliAccessErrorAsNotFound(access.error);

  return cliJson({ post: detail.post, media: detail.media });
}

export async function action(args: Route.ActionArgs) {
  const method = args.request.method;
  if (method !== "PATCH" && method !== "DELETE") return cliMethodNotAllowed();

  const env = args.context.cloudflare.env;
  const id = args.params.id ?? "";

  const post = await getPost(env.DB, id);
  if (!post) return cliError("not_found", 404);

  const access = await requireCliSnsAccess(args.request, env, post.chapterId);
  if ("error" in access) return cliAccessErrorAsNotFound(access.error);

  const deps = postDraftDepsFromEnv(env);

  if (method === "DELETE") {
    const result = await deleteDraft(deps, id);
    if (result.ok) return cliJson({ id, deleted: true });
    return cliError(result.error, result.error === "not_found" ? 404 : 409);
  }

  const parsed = await parseCliJsonBody<Record<string, unknown>>(args.request);
  if (!parsed.ok) return parsed.response;
  const patch = parseUpdatePatch(parsed.value);
  if (patch === INVALID) return cliError("invalid_request", 400);

  try {
    const updated = await updateDraft(deps, id, patch);
    return cliJson({ post: updated });
  } catch (error) {
    if (error instanceof PostDraftError) return postDraftErrorResponse(error);
    throw error;
  }
}

const INVALID = Symbol("invalid");

type UpdatePatch = {
  xAccountId?: string;
  text?: string;
  scheduledAt?: string;
  condition?: "scheduled" | "photo_required";
  tagHandles?: string[];
};

function parseUpdatePatch(body: Record<string, unknown>): UpdatePatch | typeof INVALID {
  const patch: UpdatePatch = {};
  if (body.xAccountId !== undefined) {
    if (typeof body.xAccountId !== "string") return INVALID;
    patch.xAccountId = body.xAccountId;
  }
  if (body.text !== undefined) {
    if (typeof body.text !== "string") return INVALID;
    patch.text = body.text;
  }
  if (body.scheduledAt !== undefined) {
    if (typeof body.scheduledAt !== "string") return INVALID;
    patch.scheduledAt = body.scheduledAt;
  }
  if (body.condition !== undefined) {
    if (typeof body.condition !== "string") return INVALID;
    // The aggregate service does the real `isValidCondition` check and returns
    // `invalid_condition` → 400; here we only assert the wire type.
    patch.condition = body.condition as "scheduled" | "photo_required";
  }
  if (body.tagHandles !== undefined) {
    if (
      !Array.isArray(body.tagHandles) ||
      body.tagHandles.some((entry) => typeof entry !== "string")
    ) {
      return INVALID;
    }
    patch.tagHandles = body.tagHandles as string[];
  }
  return patch;
}
