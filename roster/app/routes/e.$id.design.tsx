import { redirect } from "react-router";
import { requireUserWithChapter } from "~/features/auth/auth-redirect.server";
import { canManageEvent } from "~/features/auth/permissions";
import { getEvent } from "~/features/events/events.server";
import { getDefaultRosterSheet } from "~/features/roster-sheets/roster-sheets.server";
import { getDb } from "~/lib/db.server";
import type { Route } from "./+types/e.$id.design";

/** Legacy event design URL: keep its access check and send owners to the default sheet. */
export async function loader({ request, context, params }: Route.LoaderArgs) {
  const env = context.cloudflare.env;
  const { chapters } = await requireUserWithChapter(env, request);
  if (!params.id) throw new Response(null, { status: 404 });
  const db = getDb(env);
  const event = await getEvent(db, params.id);
  if (!event) throw new Response(null, { status: 404 });
  if (!canManageEvent(chapters, event)) throw new Response("Forbidden", { status: 403 });
  const sheet = await getDefaultRosterSheet(db, event.id);
  if (!sheet) throw new Response(null, { status: 404 });
  throw redirect(`/e/${event.id}/s/${sheet.id}/design`);
}
