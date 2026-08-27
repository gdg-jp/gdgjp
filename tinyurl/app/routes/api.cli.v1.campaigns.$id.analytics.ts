import { getCampaignAnalyticsForActor } from "~/features/campaigns";
import { requireCliActor } from "~/lib/cli-auth";
import { featureFailureResponse, invalidRequestResponse } from "~/lib/cli-errors";
import { parsePathId } from "~/lib/cli-request";
import type { components } from "../../openapi/types.generated";
import type { Route } from "./+types/api.cli.v1.campaigns.$id.analytics";

const NO_STORE = { "Cache-Control": "no-store" };

export async function loader(args: Route.LoaderArgs) {
  const env = args.context.cloudflare.env;
  const auth = await requireCliActor(env, args.request);
  if (!auth.ok) return auth.response;

  const campaignId = parsePathId(args.params.id);
  if (campaignId === null) return Response.json({ error: "Campaign not found." }, { status: 404 });

  const url = new URL(args.request.url);
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  if (!from || !to) return invalidRequestResponse("from and to are required.");

  const bucketRaw = url.searchParams.get("bucket");
  if (bucketRaw !== null && bucketRaw !== "hour" && bucketRaw !== "day") {
    return invalidRequestResponse("bucket must be hour or day.");
  }

  const channelIdRaw = url.searchParams.get("channelId");
  let channelId: number | undefined;
  if (channelIdRaw !== null) {
    const value = Number(channelIdRaw);
    if (!Number.isInteger(value) || value <= 0) return invalidRequestResponse("Invalid channelId.");
    channelId = value;
  }

  const linkId = url.searchParams.get("linkId") ?? undefined;

  const includeAutomatedRaw = url.searchParams.get("includeAutomated");
  if (includeAutomatedRaw !== null && !["true", "false"].includes(includeAutomatedRaw)) {
    return invalidRequestResponse("includeAutomated must be true or false.");
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
  return Response.json(body, { headers: NO_STORE });
}
