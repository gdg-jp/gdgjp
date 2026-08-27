import { requireCliSnsAccess } from "~/features/auth/cli-access.server";
import { postDraftDepsFromEnv } from "~/features/posts/post-draft.deps.server";
import { PostDraftError, createDraft } from "~/features/posts/post-draft.service.server";
import { listPostsPage } from "~/features/posts/post.repository.server";
import { cliAccessErrorResponse, postDraftErrorResponse } from "~/lib/cli-errors.server";
import {
  cliError,
  cliJson,
  cliMethodNotAllowed,
  decodeOffsetCursor,
  encodeOffsetCursor,
  parseCliJsonBody,
  parseLimitParam,
  parsePositiveIntParam,
} from "~/lib/cli-http.server";
import type { PostStatus } from "~/lib/db.server";
import type { Route } from "./+types/api.cli.v1.posts";

const POST_STATUSES: PostStatus[] = [
  "scheduled",
  "waiting_for_photo",
  "posting",
  "published",
  "failed",
  "needs_confirmation",
];

export async function loader(args: Route.LoaderArgs) {
  const env = args.context.cloudflare.env;
  const url = new URL(args.request.url);

  const chapterId = parsePositiveIntParam(url.searchParams.get("chapterId"));
  if (chapterId === null) return cliError("invalid_request", 400);

  const rawStatus = url.searchParams.get("status");
  if (rawStatus !== null && !POST_STATUSES.includes(rawStatus as PostStatus)) {
    return cliError("invalid_request", 400);
  }
  const limit = parseLimitParam(url.searchParams.get("limit"));
  if (limit === null) return cliError("invalid_request", 400);

  const access = await requireCliSnsAccess(args.request, env, chapterId);
  if ("error" in access) return cliAccessErrorResponse(access.error);

  const offset = decodeOffsetCursor(url.searchParams.get("cursor"));
  const { posts, hasMore } = await listPostsPage(env.DB, {
    chapterId,
    ...(rawStatus ? { status: rawStatus as PostStatus } : {}),
    limit,
    offset,
  });
  return cliJson({
    posts,
    nextCursor: hasMore ? encodeOffsetCursor(offset + limit) : null,
  });
}

export async function action(args: Route.ActionArgs) {
  if (args.request.method !== "POST") return cliMethodNotAllowed();
  const env = args.context.cloudflare.env;

  const parsed = await parseCliJsonBody<Record<string, unknown>>(args.request);
  if (!parsed.ok) return parsed.response;
  const body = parsed.value;

  const chapterId = Number(body.chapterId);
  if (!Number.isInteger(chapterId) || chapterId <= 0) return cliError("invalid_request", 400);
  if (typeof body.xAccountId !== "string" || typeof body.text !== "string") {
    return cliError("invalid_request", 400);
  }
  if (typeof body.scheduledAt !== "string" || typeof body.condition !== "string") {
    return cliError("invalid_request", 400);
  }
  const tagHandles = parseTagHandles(body.tagHandles);
  if (tagHandles === INVALID) return cliError("invalid_request", 400);

  const access = await requireCliSnsAccess(args.request, env, chapterId);
  if ("error" in access) return cliAccessErrorResponse(access.error);

  try {
    const post = await createDraft(postDraftDepsFromEnv(env), {
      chapterId,
      xAccountId: body.xAccountId,
      text: body.text,
      scheduledAt: body.scheduledAt,
      condition: body.condition as "scheduled" | "photo_required",
      createdByUserId: access.user.id,
      ...(tagHandles ? { tagHandles } : {}),
    });
    return cliJson({ post }, { status: 201 });
  } catch (error) {
    if (error instanceof PostDraftError) return postDraftErrorResponse(error);
    throw error;
  }
}

const INVALID = Symbol("invalid");

function parseTagHandles(value: unknown): string[] | undefined | typeof INVALID {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) return INVALID;
  return value as string[];
}
