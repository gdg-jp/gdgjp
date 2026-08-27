import {
  archiveCampaignForActor,
  loadCampaignForActor,
  updateCampaignForActor,
} from "~/features/campaigns";
import { requireCliActor } from "~/lib/cli-auth";
import { featureFailureResponse, invalidRequestResponse } from "~/lib/cli-errors";
import {
  integerArray,
  isInvalid,
  optionalNullableString,
  optionalString,
  parsePathId,
  readJsonBody,
} from "~/lib/cli-request";
import type { components } from "../../openapi/types.generated";
import type { Route } from "./+types/api.cli.v1.campaigns.$id";

const NO_STORE = { "Cache-Control": "no-store" };

export async function loader(args: Route.LoaderArgs) {
  const env = args.context.cloudflare.env;
  const auth = await requireCliActor(env, args.request);
  if (!auth.ok) return auth.response;

  const id = parsePathId(args.params.id);
  if (id === null) return Response.json({ error: "Campaign not found." }, { status: 404 });

  const result = await loadCampaignForActor(env.DB, auth.actor, id);
  if (!result.ok) return featureFailureResponse(result);
  const body: components["schemas"]["CliCampaignResponse"] = { campaign: result.campaign };
  return Response.json(body, { headers: NO_STORE });
}

export async function action(args: Route.ActionArgs) {
  const env = args.context.cloudflare.env;
  const auth = await requireCliActor(env, args.request);
  if (!auth.ok) return auth.response;

  const id = parsePathId(args.params.id);
  if (id === null) return Response.json({ error: "Campaign not found." }, { status: 404 });

  if (args.request.method === "PATCH") {
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

    const result = await updateCampaignForActor(env.DB, auth.actor, id, {
      name,
      code,
      defaultDestinationUrl,
      chapterIds,
    });
    if (!result.ok) return featureFailureResponse(result);
    const body: components["schemas"]["CliCampaignResponse"] = { campaign: result.campaign };
    return Response.json(body, { headers: NO_STORE });
  }

  if (args.request.method === "DELETE") {
    const result = await archiveCampaignForActor(env.DB, auth.actor, id);
    if (!result.ok) return featureFailureResponse(result);
    const body: components["schemas"]["CliArchiveResult"] = { id, archived: true };
    return Response.json(body, { headers: NO_STORE });
  }

  return new Response("Method not allowed", { status: 405 });
}
