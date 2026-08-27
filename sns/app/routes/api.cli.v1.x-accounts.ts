import { requireCliSnsAccess } from "~/features/auth/cli-access.server";
import { xAccountDepsFromEnv } from "~/features/x-accounts/x-account.deps.server";
import { listUsableXAccounts } from "~/features/x-accounts/x-account.service.server";
import { cliAccessErrorResponse } from "~/lib/cli-errors.server";
import {
  cliError,
  cliJson,
  cliMethodNotAllowed,
  parsePositiveIntParam,
} from "~/lib/cli-http.server";
import type { Route } from "./+types/api.cli.v1.x-accounts";

export async function loader(args: Route.LoaderArgs) {
  const env = args.context.cloudflare.env;
  const url = new URL(args.request.url);

  const chapterId = parsePositiveIntParam(url.searchParams.get("chapterId"));
  if (chapterId === null) return cliError("invalid_request", 400);

  const access = await requireCliSnsAccess(args.request, env, chapterId);
  if ("error" in access) return cliAccessErrorResponse(access.error);

  const accounts = await listUsableXAccounts(xAccountDepsFromEnv(env), chapterId);
  return cliJson({ accounts });
}

// This collection only supports GET; a write verb never reaches a handler
// otherwise, so answer it with the promised JSON 405.
export function action(_args: Route.ActionArgs) {
  return cliMethodNotAllowed();
}
