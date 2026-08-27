import {
  createCampaignChannelForActor,
  listCampaignChannelsForActor,
  parseIdCursor,
} from "~/features/campaigns";
import { requireCliActor } from "~/lib/cli-auth.server";
import { featureFailureResponse } from "~/lib/cli-errors.server";
import { cliError, cliJson, cliMethodNotAllowed, parseCliJsonBody } from "~/lib/cli-http.server";
import {
  isInvalid,
  optionalInteger,
  optionalString,
  parseListQuery,
  parsePathId,
} from "~/lib/cli-request";
import type { components } from "../../openapi/types.generated";
import type { Route } from "./+types/api.cli.v1.campaigns.$id.channels";

function invalidRequest(): Response {
  return cliError("invalid_request", 400);
}

export async function loader(args: Route.LoaderArgs) {
  const env = args.context.cloudflare.env;
  const auth = await requireCliActor(env, args.request);
  if (!auth.ok) return auth.response;

  const campaignId = parsePathId(args.params.id);
  if (campaignId === null) return cliError("not_found", 404);

  const url = new URL(args.request.url);
  const query = parseListQuery(url);
  if (!query) return invalidRequest();
  let cursor: number | null = null;
  if (query.cursor !== null) {
    const parsed = parseIdCursor(query.cursor);
    if (parsed === undefined) return invalidRequest();
    cursor = parsed;
  }

  const result = await listCampaignChannelsForActor(env.DB, auth.actor, campaignId, {
    includeArchived: query.includeArchived,
    limit: query.limit,
    cursor,
  });
  if (!result.ok) return featureFailureResponse(result);
  const body: components["schemas"]["CliCampaignChannelList"] = {
    channels: result.page.items,
    nextCursor: result.page.nextCursor,
  };
  return cliJson(body);
}

export async function action(args: Route.ActionArgs) {
  if (args.request.method !== "POST") return cliMethodNotAllowed();
  const env = args.context.cloudflare.env;
  const auth = await requireCliActor(env, args.request);
  if (!auth.ok) return auth.response;

  const campaignId = parsePathId(args.params.id);
  if (campaignId === null) return cliError("not_found", 404);

  const parsed = await parseCliJsonBody<Record<string, unknown>>(args.request);
  if (!parsed.ok) return parsed.response;
  const requestBody = parsed.value;
  const name = optionalString(requestBody, "name");
  const code = optionalString(requestBody, "code");
  const sortOrder = optionalInteger(requestBody, "sortOrder");
  if (isInvalid(name) || isInvalid(code) || isInvalid(sortOrder)) {
    return invalidRequest();
  }
  if (!name || !code) return invalidRequest();

  const result = await createCampaignChannelForActor(env.DB, auth.actor, campaignId, {
    name,
    code,
    sortOrder,
  });
  if (!result.ok) return featureFailureResponse(result);
  const body: components["schemas"]["CliCampaignChannelResponse"] = { channel: result.channel };
  return cliJson(body, { status: 201 });
}
