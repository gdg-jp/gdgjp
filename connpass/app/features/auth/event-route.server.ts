import { getBearerIdentity } from "@gdgjp/gdg-lib";
import type { LoaderFunctionArgs } from "react-router";
import { accountsBaseUrl } from "./accounts-url.server";
import { canReadGroup, canWriteGroup, getAllowedGroup, resolveGroupSlug } from "./authorize.server";

export async function authorizeEventRoute(
  args: Pick<LoaderFunctionArgs, "request" | "context" | "params">,
  write: boolean,
) {
  const { env, ctx } = args.context.cloudflare;
  const identity = await getBearerIdentity(args.request, accountsBaseUrl(env));
  if (!identity) return { error: Response.json({ error: "invalid_token" }, { status: 401 }) };
  const groupSlug = resolveGroupSlug(args.params.groupId ?? "");
  const group = await getAllowedGroup(env.DB, groupSlug);
  if (!group || !(write ? canWriteGroup(identity, group) : canReadGroup(identity, group))) {
    return { error: Response.json({ error: "forbidden" }, { status: 403 }) };
  }
  const eventId = args.params.eventId;
  if (!eventId) return { error: Response.json({ error: "not_found" }, { status: 404 }) };
  return { env, ctx, identity, group, eventId };
}
