import {
  archiveCampaignChannelForActor,
  updateCampaignChannelForActor,
} from "~/features/campaigns";
import { requireCliActor } from "~/lib/cli-auth.server";
import { featureFailureResponse } from "~/lib/cli-errors.server";
import { cliError, cliJson, cliMethodNotAllowed, parseCliJsonBody } from "~/lib/cli-http.server";
import { isInvalid, optionalInteger, optionalString, parsePathId } from "~/lib/cli-request";
import type { components } from "../../openapi/types.generated";
import type { Route } from "./+types/api.cli.v1.campaigns.$id.channels.$channelId";

export async function action(args: Route.ActionArgs) {
  const env = args.context.cloudflare.env;
  const auth = await requireCliActor(env, args.request);
  if (!auth.ok) return auth.response;

  const campaignId = parsePathId(args.params.id);
  const channelId = parsePathId(args.params.channelId);
  if (campaignId === null || channelId === null) return cliError("not_found", 404);

  if (args.request.method === "PATCH") {
    const parsed = await parseCliJsonBody<Record<string, unknown>>(args.request);
    if (!parsed.ok) return parsed.response;
    const requestBody = parsed.value;
    const name = optionalString(requestBody, "name");
    const code = optionalString(requestBody, "code");
    const sortOrder = optionalInteger(requestBody, "sortOrder");
    if (isInvalid(name) || isInvalid(code) || isInvalid(sortOrder)) {
      return cliError("invalid_request", 400);
    }

    const result = await updateCampaignChannelForActor(env.DB, auth.actor, campaignId, channelId, {
      name,
      code,
      sortOrder,
    });
    if (!result.ok) return featureFailureResponse(result);
    const body: components["schemas"]["CliCampaignChannelResponse"] = { channel: result.channel };
    return cliJson(body);
  }

  if (args.request.method === "DELETE") {
    const result = await archiveCampaignChannelForActor(env.DB, auth.actor, campaignId, channelId);
    if (!result.ok) return featureFailureResponse(result);
    const body: components["schemas"]["CliArchiveResult"] = { id: channelId, archived: true };
    return cliJson(body);
  }

  return cliMethodNotAllowed();
}
