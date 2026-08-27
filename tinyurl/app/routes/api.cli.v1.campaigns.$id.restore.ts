import { restoreCampaignForActor } from "~/features/campaigns";
import { requireCliActor } from "~/lib/cli-auth";
import { featureFailureResponse } from "~/lib/cli-errors";
import { parsePathId } from "~/lib/cli-request";
import type { components } from "../../openapi/types.generated";
import type { Route } from "./+types/api.cli.v1.campaigns.$id.restore";

const NO_STORE = { "Cache-Control": "no-store" };

export async function action(args: Route.ActionArgs) {
  if (args.request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }
  const env = args.context.cloudflare.env;
  const auth = await requireCliActor(env, args.request);
  if (!auth.ok) return auth.response;

  const id = parsePathId(args.params.id);
  if (id === null) return Response.json({ error: "Campaign not found." }, { status: 404 });

  const result = await restoreCampaignForActor(env.DB, auth.actor, id);
  if (!result.ok) return featureFailureResponse(result);
  const body: components["schemas"]["CliCampaignResponse"] = { campaign: result.campaign };
  return Response.json(body, { headers: NO_STORE });
}
