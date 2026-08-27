import { createCampaignForActor, listCampaignsForActor, parseIdCursor } from "~/features/campaigns";
import { requireCliActor } from "~/lib/cli-auth.server";
import { featureFailureResponse } from "~/lib/cli-errors.server";
import { cliError, cliJson, cliMethodNotAllowed, parseCliJsonBody } from "~/lib/cli-http.server";
import {
  integerArray,
  isInvalid,
  optionalNullableString,
  optionalString,
  parseListQuery,
} from "~/lib/cli-request";
import type { components } from "../../openapi/types.generated";
import type { Route } from "./+types/api.cli.v1.campaigns";

function invalidRequest(): Response {
  return cliError("invalid_request", 400);
}

export async function loader(args: Route.LoaderArgs) {
  const env = args.context.cloudflare.env;
  const auth = await requireCliActor(env, args.request);
  if (!auth.ok) return auth.response;

  const url = new URL(args.request.url);
  const query = parseListQuery(url);
  if (!query) return invalidRequest();
  let cursor: number | null = null;
  if (query.cursor !== null) {
    const parsed = parseIdCursor(query.cursor);
    if (parsed === undefined) return invalidRequest();
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
  return cliJson(body);
}

export async function action(args: Route.ActionArgs) {
  if (args.request.method !== "POST") return cliMethodNotAllowed();
  const env = args.context.cloudflare.env;
  const auth = await requireCliActor(env, args.request);
  if (!auth.ok) return auth.response;

  const parsed = await parseCliJsonBody<Record<string, unknown>>(args.request);
  if (!parsed.ok) return parsed.response;
  const requestBody = parsed.value;
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
    return invalidRequest();
  }
  if (!name || !code || chapterIds === undefined) return invalidRequest();

  const result = await createCampaignForActor(env.DB, auth.actor, {
    name,
    code,
    defaultDestinationUrl: defaultDestinationUrl ?? null,
    chapterIds,
  });
  if (!result.ok) return featureFailureResponse(result);
  const body: components["schemas"]["CliCampaignResponse"] = { campaign: result.campaign };
  return cliJson(body, { status: 201 });
}
