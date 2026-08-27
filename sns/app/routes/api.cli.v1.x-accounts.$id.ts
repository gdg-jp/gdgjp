import { requireCliSnsAccess } from "~/features/auth/cli-access.server";
import { xAccountDepsFromEnv } from "~/features/x-accounts/x-account.deps.server";
import { getXAccount } from "~/features/x-accounts/x-account.repository.server";
import { XAccountError, revokeXAccount } from "~/features/x-accounts/x-account.service.server";
import { cliAccessErrorAsNotFound } from "~/lib/cli-errors.server";
import { cliError, cliJson, cliMethodNotAllowed, parseCliJsonBody } from "~/lib/cli-http.server";
import type { Route } from "./+types/api.cli.v1.x-accounts.$id";

// Action-only route: a GET/HEAD never reaches `action`, so answer it here with
// the same JSON 405 the HTTP boundary promises.
export function loader(_args: Route.LoaderArgs) {
  return cliMethodNotAllowed();
}

export async function action(args: Route.ActionArgs) {
  if (args.request.method !== "DELETE") return cliMethodNotAllowed();
  const env = args.context.cloudflare.env;
  const id = args.params.id ?? "";

  // Authorize against the account's own chapter, never a caller-supplied one.
  const account = await getXAccount(env.DB, id);
  if (!account) return cliError("not_found", 404);

  const access = await requireCliSnsAccess(args.request, env, account.chapterId);
  if ("error" in access) return cliAccessErrorAsNotFound(access.error);

  const parsed = await parseCliJsonBody<Record<string, unknown>>(args.request);
  if (!parsed.ok) return parsed.response;
  const xUserId = parsed.value.xUserId;
  if (typeof xUserId !== "string" || xUserId.length === 0) {
    return cliError("invalid_request", 400);
  }

  try {
    await revokeXAccount(xAccountDepsFromEnv(env), id, account.chapterId, xUserId);
  } catch (error) {
    if (error instanceof XAccountError) return cliError("x_user_id_mismatch", 400);
    throw error;
  }
  return cliJson({ id, revoked: true });
}
