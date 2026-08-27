import { requireCliSnsOrganizer } from "~/features/auth/cli-access.server";
import { contributorDepsFromEnv } from "~/features/contributors/contributor.deps.server";
import {
  addContributor,
  listChapterContributorsPage,
  removeContributor,
} from "~/features/contributors/contributor.service.server";
import { cliAccessErrorResponse } from "~/lib/cli-errors.server";
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
import { isValidEmail } from "~/lib/utils";
import type { Route } from "./+types/api.cli.v1.contributors";

export async function loader(args: Route.LoaderArgs) {
  const env = args.context.cloudflare.env;
  const url = new URL(args.request.url);

  const chapterId = parsePositiveIntParam(url.searchParams.get("chapterId"));
  if (chapterId === null) return cliError("invalid_request", 400);
  const limit = parseLimitParam(url.searchParams.get("limit"));
  if (limit === null) return cliError("invalid_request", 400);

  const access = await requireCliSnsOrganizer(args.request, env, chapterId);
  if ("error" in access) return cliAccessErrorResponse(access.error);

  const offset = decodeOffsetCursor(url.searchParams.get("cursor"));
  const { contributors, hasMore } = await listChapterContributorsPage(contributorDepsFromEnv(env), {
    chapterId,
    limit,
    offset,
  });
  return cliJson({
    contributors,
    nextCursor: hasMore ? encodeOffsetCursor(offset + limit) : null,
  });
}

export async function action(args: Route.ActionArgs) {
  const method = args.request.method;
  if (method !== "POST" && method !== "DELETE") return cliMethodNotAllowed();
  const env = args.context.cloudflare.env;
  const deps = contributorDepsFromEnv(env);

  if (method === "DELETE") {
    const url = new URL(args.request.url);
    const chapterId = parsePositiveIntParam(url.searchParams.get("chapterId"));
    const email = (url.searchParams.get("userEmail") ?? "").trim().toLowerCase();
    if (chapterId === null || !isValidEmail(email)) return cliError("invalid_request", 400);

    const access = await requireCliSnsOrganizer(args.request, env, chapterId);
    if ("error" in access) return cliAccessErrorResponse(access.error);

    await removeContributor(deps, chapterId, email);
    return cliJson({ deleted: true });
  }

  const parsed = await parseCliJsonBody<Record<string, unknown>>(args.request);
  if (!parsed.ok) return parsed.response;
  const chapterId = Number(parsed.value.chapterId);
  const email = String(parsed.value.userEmail ?? "")
    .trim()
    .toLowerCase();
  if (!Number.isInteger(chapterId) || chapterId <= 0 || !isValidEmail(email)) {
    return cliError("invalid_request", 400);
  }

  const access = await requireCliSnsOrganizer(args.request, env, chapterId);
  if ("error" in access) return cliAccessErrorResponse(access.error);

  await addContributor(deps, chapterId, email, access.user.id);
  return cliJson({ chapterId, userEmail: email }, { status: 201 });
}
