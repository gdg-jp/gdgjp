import {
  archiveCampaignForActor,
  loadCampaignForActor,
  updateCampaignForActor,
} from "~/features/campaigns";
import { requireCliActor } from "~/lib/cli-auth.server";
import { featureFailureResponse } from "~/lib/cli-errors.server";
import { cliError, cliJson, cliMethodNotAllowed, parseCliJsonBody } from "~/lib/cli-http.server";
import {
  integerArray,
  isInvalid,
  optionalNullableString,
  optionalString,
  parsePathId,
} from "~/lib/cli-request";
import type { components } from "../../openapi/types.generated";
import type { Route } from "./+types/api.cli.v1.campaigns.$id";

function notFound(): Response {
  return cliError("not_found", 404);
}

function invalidRequest(): Response {
  return cliError("invalid_request", 400);
}

export async function loader(args: Route.LoaderArgs) {
  const env = args.context.cloudflare.env;
  const auth = await requireCliActor(env, args.request);
  if (!auth.ok) return auth.response;

  const id = parsePathId(args.params.id);
  if (id === null) return notFound();

  const result = await loadCampaignForActor(env.DB, auth.actor, id);
  if (!result.ok) return featureFailureResponse(result);
  const body: components["schemas"]["CliCampaignResponse"] = { campaign: result.campaign };
  return cliJson(body);
}

export async function action(args: Route.ActionArgs) {
  const env = args.context.cloudflare.env;
  const auth = await requireCliActor(env, args.request);
  if (!auth.ok) return auth.response;

  const id = parsePathId(args.params.id);
  if (id === null) return notFound();

  if (args.request.method === "PATCH") {
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

    const result = await updateCampaignForActor(env.DB, auth.actor, id, {
      name,
      code,
      defaultDestinationUrl,
      chapterIds,
    });
    if (!result.ok) return featureFailureResponse(result);
    const body: components["schemas"]["CliCampaignResponse"] = { campaign: result.campaign };
    return cliJson(body);
  }

  if (args.request.method === "DELETE") {
    const result = await archiveCampaignForActor(env.DB, auth.actor, id);
    if (!result.ok) return featureFailureResponse(result);
    const body: components["schemas"]["CliArchiveResult"] = { id, archived: true };
    return cliJson(body);
  }

  return cliMethodNotAllowed();
}
