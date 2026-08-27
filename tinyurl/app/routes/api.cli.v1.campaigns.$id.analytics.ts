import { getCampaignAnalyticsForActor } from "~/features/campaigns";
import { requireCliActor } from "~/lib/cli-auth.server";
import { featureFailureResponse } from "~/lib/cli-errors.server";
import { cliError, cliJson } from "~/lib/cli-http.server";
import { parsePathId } from "~/lib/cli-request";
import type { components } from "../../openapi/types.generated";
import type { Route } from "./+types/api.cli.v1.campaigns.$id.analytics";

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
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  if (!from || !to) return invalidRequest();

  const bucketRaw = url.searchParams.get("bucket");
  if (bucketRaw !== null && bucketRaw !== "hour" && bucketRaw !== "day") {
    return invalidRequest();
  }

  const channelIdRaw = url.searchParams.get("channelId");
  let channelId: number | undefined;
  if (channelIdRaw !== null) {
    const value = Number(channelIdRaw);
    if (!Number.isInteger(value) || value <= 0) return invalidRequest();
    channelId = value;
  }

  const linkId = url.searchParams.get("linkId") ?? undefined;

  const includeAutomatedRaw = url.searchParams.get("includeAutomated");
  if (includeAutomatedRaw !== null && !["true", "false"].includes(includeAutomatedRaw)) {
    return invalidRequest();
  }
  const includeAutomated = includeAutomatedRaw === "true";

  const result = await getCampaignAnalyticsForActor(env, auth.actor, campaignId, {
    from,
    to,
    bucket: bucketRaw ?? undefined,
    channelId,
    linkId,
    includeAutomated,
  });
  if (!result.ok) return featureFailureResponse(result);
  const body: components["schemas"]["CliCampaignAnalyticsResponse"] = {
    analytics: result.analytics,
  };
  return cliJson(body);
}
