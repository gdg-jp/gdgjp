import { createDomainProvider } from "~/features/domains";
import { createDomainSyncJob } from "~/features/domains/domain-job.service.server";
import { requireCliActor } from "~/lib/cli-auth.server";
import { domainJobErrorResponse } from "~/lib/cli-errors.server";
import { cliError, cliJson, cliMethodNotAllowed } from "~/lib/cli-http.server";
import { detectCustomDomain } from "~/lib/domain-detection";
import type { components } from "../../openapi/types.generated";
import type { Route } from "./+types/api.cli.v1.domains.$id.sync";

export async function action(args: Route.ActionArgs) {
  if (args.request.method !== "POST") return cliMethodNotAllowed();
  const env = args.context.cloudflare.env;
  const ctx = args.context.cloudflare.ctx;
  const auth = await requireCliActor(env, args.request);
  if (!auth.ok) return auth.response;

  const id = Number(args.params.id);
  if (!Number.isInteger(id)) return cliError("not_found", 404);

  const deps = {
    db: env.DB,
    provider: createDomainProvider(env),
    detectCustomDomain,
  };
  const result = await createDomainSyncJob(deps, env, ctx, auth.actor, id);
  if (!result.ok) return domainJobErrorResponse(result);
  const body: components["schemas"]["JobResponse"] = { job: result.job };
  return cliJson(body, { status: 202 });
}
