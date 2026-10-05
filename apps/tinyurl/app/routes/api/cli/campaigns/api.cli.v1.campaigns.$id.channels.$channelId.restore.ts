import { requireCliActor } from "~/features/auth/cli-auth.server";
import { restoreCampaignChannelForActor } from "~/features/campaigns";
import { featureFailureResponse } from "~/features/cli-api/cli-errors.server";
import { cliError, cliJson, cliMethodNotAllowed } from "~/features/cli-api/cli-http.server";
import { parsePathId } from "~/features/cli-api/cli-request";
import type { components } from "../../../../../openapi/types.generated";
import type { Route } from "./+types/api.cli.v1.campaigns.$id.channels.$channelId.restore";

export async function action(args: Route.ActionArgs) {
  if (args.request.method !== "POST") return cliMethodNotAllowed();
  const env = args.context.cloudflare.env;
  const auth = await requireCliActor(env, args.request);
  if (!auth.ok) return auth.response;

  const campaignId = parsePathId(args.params.id);
  const channelId = parsePathId(args.params.channelId);
  if (campaignId === null || channelId === null) return cliError("not_found", 404);

  const result = await restoreCampaignChannelForActor(env.DB, auth.actor, campaignId, channelId);
  if (!result.ok) return featureFailureResponse(result);
  const body: components["schemas"]["CliCampaignChannelResponse"] = { channel: result.channel };
  return cliJson(body);
}
