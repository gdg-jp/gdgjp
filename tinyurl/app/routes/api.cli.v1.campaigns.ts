import { createCampaignForActor, listCampaignsForActor, parseIdCursor } from "~/features/campaigns";
import { requireCliActor } from "~/lib/cli-auth";
import { featureFailureResponse, invalidRequestResponse } from "~/lib/cli-errors";
import {
  integerArray,
  isInvalid,
  optionalNullableString,
  optionalString,
  parseListQuery,
  readJsonBody,
} from "~/lib/cli-request";
import type { components } from "../../openapi/types.generated";
import type { Route } from "./+types/api.cli.v1.campaigns";

const NO_STORE = { "Cache-Control": "no-store" };

export async function loader(args: Route.LoaderArgs) {
  const env = args.context.cloudflare.env;
  const auth = await requireCliActor(env, args.request);
  if (!auth.ok) return auth.response;

  const url = new URL(args.request.url);
  const query = parseListQuery(url);
  if (!query) return invalidRequestResponse("Invalid includeArchived, limit, or cursor.");
  let cursor: number | null = null;
  if (query.cursor !== null) {
    const parsed = parseIdCursor(query.cursor);
    if (parsed === undefined) return invalidRequestResponse("Invalid cursor.");
    cursor = parsed;
  }

  const page = await listCampaignsForActor(env.DB, auth.actor, {
    includeArchived: query.includeArchived,
    limit: query.limit,
    cursor,
  });
  const campaigns = page.items.map(
    ({ channelCount: _channelCount, linkCount: _linkCount, ...campaign }) => campaign,
  );
  const body: components["schemas"]["CliCampaignList"] = { campaigns, nextCursor: page.nextCursor };
  return Response.json(body, { headers: NO_STORE });
}

export async function action(args: Route.ActionArgs) {
  if (args.request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }
  const env = args.context.cloudflare.env;
  const auth = await requireCliActor(env, args.request);
  if (!auth.ok) return auth.response;

  const requestBody = await readJsonBody(args.request);
  if (!requestBody) return invalidRequestResponse("Request body must be a JSON object.");
  const name = optionalString(requestBody, "name");
  const code = optionalString(requestBody, "code");
  const defaultDestinationUrl = optionalNullableString(requestBody, "defaultDestinationUrl");
  const chapterIds = integerArray(requestBody, "chapterIds");
  if (
    isInvalid(name) ||
    isInvalid(code) ||
    isInvalid(defaultDestinationUrl) ||
    isInvalid(chapterIds)
  ) {
    return invalidRequestResponse(
      "name, code, defaultDestinationUrl, or chapterIds has an invalid type.",
    );
  }
  if (!name || !code || chapterIds === undefined) {
    return invalidRequestResponse("name, code, and chapterIds are required.");
  }

  const result = await createCampaignForActor(env.DB, auth.actor, {
    name,
    code,
    defaultDestinationUrl: defaultDestinationUrl ?? null,
    chapterIds,
  });
  if (!result.ok) return featureFailureResponse(result);
  const body: components["schemas"]["CliCampaignResponse"] = { campaign: result.campaign };
  return Response.json(body, { status: 201, headers: NO_STORE });
}
