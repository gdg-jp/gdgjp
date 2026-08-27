import {
  archiveCampaignChannelSourceForActor,
  updateCampaignChannelSourceForActor,
} from "~/features/campaigns";
import { requireCliActor } from "~/lib/cli-auth.server";
import { featureFailureResponse } from "~/lib/cli-errors.server";
import { cliError, cliJson, cliMethodNotAllowed, parseCliJsonBody } from "~/lib/cli-http.server";
import { isInvalid, optionalString, parsePathId } from "~/lib/cli-request";
import type { components } from "../../openapi/types.generated";
import type { Route } from "./+types/api.cli.v1.campaigns.$id.channels.$channelId.sources.$sourceId";

export async function action(args: Route.ActionArgs) {
  const env = args.context.cloudflare.env;
  const auth = await requireCliActor(env, args.request);
  if (!auth.ok) return auth.response;

  const campaignId = parsePathId(args.params.id);
  const channelId = parsePathId(args.params.channelId);
  const sourceId = parsePathId(args.params.sourceId);
  if (campaignId === null || channelId === null || sourceId === null) {
    return cliError("not_found", 404);
  }

  if (args.request.method === "PATCH") {
    const parsed = await parseCliJsonBody<Record<string, unknown>>(args.request);
    if (!parsed.ok) return parsed.response;
    const requestBody = parsed.value;
    const name = optionalString(requestBody, "name");
    const code = optionalString(requestBody, "code");
    if (isInvalid(name) || isInvalid(code)) {
      return cliError("invalid_request", 400);
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
    return cliJson(body);
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
    return cliJson(body);
  }

  return cliMethodNotAllowed();
}
