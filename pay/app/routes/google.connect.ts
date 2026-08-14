import { redirect } from "react-router";
import { canViewAllClaims, requireMember } from "~/lib/auth-redirect.server";
import { getEvent, insertOAuthTransaction } from "~/lib/db.server";
import { googleAuthorizationUrl, randomVerifier } from "~/lib/google-oauth.server";
import { isEventId } from "~/lib/id";
import type { Route } from "./+types/google.connect";

export async function loader({ request, context }: Route.LoaderArgs) {
  const env = context.cloudflare.env;
  const { user, chapters } = await requireMember(env, request);
  const url = new URL(request.url);
  const eventId = url.searchParams.get("event_id") ?? "";
  if (!isEventId(eventId)) throw new Response("Not Found", { status: 404 });
  const event = await getEvent(env.DB, eventId);
  if (!event) throw new Response("Not Found", { status: 404 });
  if (!canViewAllClaims({ userId: user.id, chapters }, event)) {
    throw new Response("Forbidden", { status: 403 });
  }

  const state = crypto.randomUUID();
  const verifier = randomVerifier();
  await insertOAuthTransaction(env.DB, {
    state,
    userId: user.id,
    eventId: event.id,
    codeVerifier: verifier,
    returnTo: `/events/${event.id}`,
  });
  throw redirect(await googleAuthorizationUrl(env, state, verifier));
}
