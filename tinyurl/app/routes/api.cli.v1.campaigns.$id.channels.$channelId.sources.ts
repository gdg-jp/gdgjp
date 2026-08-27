import {
  createCampaignChannelSourceForActor,
  listCampaignChannelSourcesForActor,
  parseIdCursor,
} from "~/features/campaigns";
import { requireCliActor } from "~/lib/cli-auth";
import { featureFailureResponse, invalidRequestResponse } from "~/lib/cli-errors";
import {
  isInvalid,
  optionalString,
  parseListQuery,
  parsePathId,
  readJsonBody,
} from "~/lib/cli-request";
import type { components } from "../../openapi/types.generated";
import type { Route } from "./+types/api.cli.v1.campaigns.$id.channels.$channelId.sources";

const NO_STORE = { "Cache-Control": "no-store" };

export async function loader(args: Route.LoaderArgs) {
  const env = args.context.cloudflare.env;
  const auth = await requireCliActor(env, args.request);
  if (!auth.ok) return auth.response;

  const campaignId = parsePathId(args.params.id);
  const channelId = parsePathId(args.params.channelId);
  if (campaignId === null || channelId === null) {
    return Response.json({ error: "Channel not found." }, { status: 404 });
  }

  const url = new URL(args.request.url);
  const query = parseListQuery(url);
  if (!query) return invalidRequestResponse("Invalid includeArchived, limit, or cursor.");
  let cursor: number | null = null;
  if (query.cursor !== null) {
    const parsed = parseIdCursor(query.cursor);
    if (parsed === undefined) return invalidRequestResponse("Invalid cursor.");
    cursor = parsed;
  }

  const result = await listCampaignChannelSourcesForActor(
    env.DB,
    auth.actor,
    campaignId,
    channelId,
    {
      includeArchived: query.includeArchived,
      limit: query.limit,
      cursor,
    },
  );
  if (!result.ok) return featureFailureResponse(result);
  const body: components["schemas"]["CliCampaignChannelSourceList"] = {
    sources: result.page.items,
    nextCursor: result.page.nextCursor,
  };
  return Response.json(body, { headers: NO_STORE });
}

export async function action(args: Route.ActionArgs) {
  if (args.request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }
  const env = args.context.cloudflare.env;
  const auth = await requireCliActor(env, args.request);
  if (!auth.ok) return auth.response;

  const campaignId = parsePathId(args.params.id);
  const channelId = parsePathId(args.params.channelId);
  if (campaignId === null || channelId === null) {
    return Response.json({ error: "Channel not found." }, { status: 404 });
  }

  const requestBody = await readJsonBody(args.request);
  if (!requestBody) return invalidRequestResponse("Request body must be a JSON object.");
  const name = optionalString(requestBody, "name");
  const code = optionalString(requestBody, "code");
  if (isInvalid(name) || isInvalid(code)) {
    return invalidRequestResponse("name or code has an invalid type.");
  }
  if (!name || !code) return invalidRequestResponse("name and code are required.");

  const result = await createCampaignChannelSourceForActor(
    env.DB,
    auth.actor,
    campaignId,
    channelId,
    {
      name,
      code,
    },
  );
  if (!result.ok) return featureFailureResponse(result);
  const body: components["schemas"]["CliCampaignChannelSourceResponse"] = {
    source: result.source,
  };
  return Response.json(body, { status: 201, headers: NO_STORE });
}
