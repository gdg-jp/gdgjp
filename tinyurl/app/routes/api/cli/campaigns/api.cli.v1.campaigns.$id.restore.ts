import { requireCliActor } from "~/features/auth/cli-auth.server";
import { restoreCampaignForActor } from "~/features/campaigns";
import { featureFailureResponse } from "~/features/cli-api/cli-errors.server";
import { cliError, cliJson, cliMethodNotAllowed } from "~/features/cli-api/cli-http.server";
import { parsePathId } from "~/features/cli-api/cli-request";
import type { components } from "../../../../../openapi/types.generated";
import type { Route } from "./+types/api.cli.v1.campaigns.$id.restore";

export async function action(args: Route.ActionArgs) {
  if (args.request.method !== "POST") return cliMethodNotAllowed();
  const env = args.context.cloudflare.env;
  const auth = await requireCliActor(env, args.request);
  if (!auth.ok) return auth.response;

  const id = parsePathId(args.params.id);
  if (id === null) return cliError("not_found", 404);

  const result = await restoreCampaignForActor(env.DB, auth.actor, id);
  if (!result.ok) return featureFailureResponse(result);
  const body: components["schemas"]["CliCampaignResponse"] = { campaign: result.campaign };
  return cliJson(body);
}
