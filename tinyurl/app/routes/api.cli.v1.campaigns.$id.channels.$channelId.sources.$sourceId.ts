import {
  archiveCampaignChannelSourceForActor,
  updateCampaignChannelSourceForActor,
} from "~/features/campaigns";
import { requireCliActor } from "~/lib/cli-auth";
import { featureFailureResponse, invalidRequestResponse } from "~/lib/cli-errors";
import { isInvalid, optionalString, parsePathId, readJsonBody } from "~/lib/cli-request";
import type { components } from "../../openapi/types.generated";
import type { Route } from "./+types/api.cli.v1.campaigns.$id.channels.$channelId.sources.$sourceId";

const NO_STORE = { "Cache-Control": "no-store" };

export async function action(args: Route.ActionArgs) {
  const env = args.context.cloudflare.env;
  const auth = await requireCliActor(env, args.request);
  if (!auth.ok) return auth.response;

  const campaignId = parsePathId(args.params.id);
  const channelId = parsePathId(args.params.channelId);
  const sourceId = parsePathId(args.params.sourceId);
  if (campaignId === null || channelId === null || sourceId === null) {
    return Response.json({ error: "Source not found." }, { status: 404 });
  }

  if (args.request.method === "PATCH") {
    const requestBody = await readJsonBody(args.request);
    if (!requestBody) return invalidRequestResponse("Request body must be a JSON object.");
    const name = optionalString(requestBody, "name");
    const code = optionalString(requestBody, "code");
    if (isInvalid(name) || isInvalid(code)) {
      return invalidRequestResponse("name or code has an invalid type.");
    }

    const result = await updateCampaignChannelSourceForActor(
      env.DB,
      auth.actor,
      campaignId,
      channelId,
      sourceId,
      { name, code },
    );
    if (!result.ok) return featureFailureResponse(result);
    const body: components["schemas"]["CliCampaignChannelSourceResponse"] = {
      source: result.source,
    };
    return Response.json(body, { headers: NO_STORE });
  }

  if (args.request.method === "DELETE") {
    const result = await archiveCampaignChannelSourceForActor(
      env.DB,
      auth.actor,
      campaignId,
      channelId,
      sourceId,
    );
    if (!result.ok) return featureFailureResponse(result);
    const body: components["schemas"]["CliArchiveResult"] = { id: sourceId, archived: true };
    return Response.json(body, { headers: NO_STORE });
  }

  return new Response("Method not allowed", { status: 405 });
}
