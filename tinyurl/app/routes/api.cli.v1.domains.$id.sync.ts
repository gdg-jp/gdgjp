import {
  createDomainProvider,
  getDomainById,
  manageableChapterIds,
  syncDomain,
} from "~/features/domains";
import { requireCliActor } from "~/lib/cli-auth.server";
import { cliError, cliJson, cliMethodNotAllowed } from "~/lib/cli-http.server";
import { detectCustomDomain } from "~/lib/domain-detection";
import type { components } from "../../openapi/types.generated";
import type { Route } from "./+types/api.cli.v1.domains.$id.sync";

export async function action(args: Route.ActionArgs) {
  if (args.request.method !== "POST") return cliMethodNotAllowed();
  const env = args.context.cloudflare.env;
  const auth = await requireCliActor(env, args.request);
  if (!auth.ok) return auth.response;

  const id = Number(args.params.id);
  if (!Number.isInteger(id)) return cliError("not_found", 404);

  const domain = await getDomainById(env.DB, id);
  if (!domain) return cliError("not_found", 404);

  const manageableIds = manageableChapterIds(auth.actor.user, auth.actor.chapters);
  if (domain.ownerChapterId === null || !manageableIds.includes(domain.ownerChapterId)) {
    return cliError("forbidden", 403);
  }
  if (domain.status === "active") {
    return cliError("This domain is already active.", 409);
  }

  const deps = {
    db: env.DB,
    provider: createDomainProvider(env),
    detectCustomDomain,
  };
  const result = await syncDomain(deps, id);
  const body: components["schemas"]["DomainResponse"] = { domain: result.domain };
  return cliJson(body);
}
