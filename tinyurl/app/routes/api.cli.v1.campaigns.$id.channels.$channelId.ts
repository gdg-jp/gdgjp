import {
  archiveCampaignChannelForActor,
  updateCampaignChannelForActor,
} from "~/features/campaigns";
import { requireCliActor } from "~/lib/cli-auth";
import { featureFailureResponse, invalidRequestResponse } from "~/lib/cli-errors";
import {
  isInvalid,
  optionalInteger,
  optionalString,
  parsePathId,
  readJsonBody,
} from "~/lib/cli-request";
import type { components } from "../../openapi/types.generated";
import type { Route } from "./+types/api.cli.v1.campaigns.$id.channels.$channelId";

const NO_STORE = { "Cache-Control": "no-store" };

export async function action(args: Route.ActionArgs) {
  const env = args.context.cloudflare.env;
  const auth = await requireCliActor(env, args.request);
  if (!auth.ok) return auth.response;

  const campaignId = parsePathId(args.params.id);
  const channelId = parsePathId(args.params.channelId);
  if (campaignId === null || channelId === null) {
    return Response.json({ error: "Channel not found." }, { status: 404 });
  }

  if (args.request.method === "PATCH") {
    const requestBody = await readJsonBody(args.request);
    if (!requestBody) return invalidRequestResponse("Request body must be a JSON object.");
    const name = optionalString(requestBody, "name");
    const code = optionalString(requestBody, "code");
    const sortOrder = optionalInteger(requestBody, "sortOrder");
    if (isInvalid(name) || isInvalid(code) || isInvalid(sortOrder)) {
      return invalidRequestResponse("name, code, or sortOrder has an invalid type.");
    }

    const result = await updateCampaignChannelForActor(env.DB, auth.actor, campaignId, channelId, {
      name,
      code,
      sortOrder,
    });
    if (!result.ok) return featureFailureResponse(result);
    const body: components["schemas"]["CliCampaignChannelResponse"] = { channel: result.channel };
    return Response.json(body, { headers: NO_STORE });
  }

  if (args.request.method === "DELETE") {
    const result = await archiveCampaignChannelForActor(env.DB, auth.actor, campaignId, channelId);
    if (!result.ok) return featureFailureResponse(result);
    const body: components["schemas"]["CliArchiveResult"] = { id: channelId, archived: true };
    return Response.json(body, { headers: NO_STORE });
  }

  return new Response("Method not allowed", { status: 405 });
}
