import { requireMember } from "~/lib/auth-redirect.server";
import { canViewAllClaims } from "~/lib/auth-redirect.server";
import { getClaim, getEvent, listClaimItems } from "~/lib/db.server";
import type { Route } from "./+types/receipts.$";

export async function loader({ request, context, params }: Route.LoaderArgs) {
  const env = context.cloudflare.env;
  const { user, chapters } = await requireMember(env, request);
  const key = params["*"];
  if (!key || key.includes("..")) throw new Response("Not Found", { status: 404 });

  const object = await env.RECEIPTS.get(key);
  if (!object) throw new Response("Not Found", { status: 404 });

  // Key format: claims/{claimId}/...
  const match = key.match(/^claims\/(clm_[A-Z0-9]+)\//);
  if (!match) throw new Response("Forbidden", { status: 403 });
  const claim = await getClaim(env.DB, match[1]);
  if (!claim) throw new Response("Not Found", { status: 404 });
  const event = await getEvent(env.DB, claim.event_id);
  if (!event) throw new Response("Not Found", { status: 404 });
  const actor = { userId: user.id, chapters };
  const allowed =
    claim.user_id === user.id || claim.created_by === user.id || canViewAllClaims(actor, event);
  if (!allowed) throw new Response("Forbidden", { status: 403 });

  // Ensure the object belongs to a known item for this claim.
  const items = await listClaimItems(env.DB, claim.id);
  if (!items.some((item) => item.receipt_r2_key === key)) {
    throw new Response("Forbidden", { status: 403 });
  }

  const headers = new Headers();
  headers.set("Content-Type", object.httpMetadata?.contentType ?? "application/octet-stream");
  headers.set("Cache-Control", "private, max-age=300");
  return new Response(object.body, { headers });
}
