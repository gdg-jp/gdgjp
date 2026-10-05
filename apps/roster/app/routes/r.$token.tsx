import { getEventByViewToken } from "~/features/events/events.server";
import { PublicRosterPage } from "~/features/public-roster/PublicRosterPage";
import { buildPublicRosterData } from "~/features/public-roster/public-roster.server";
import { getDb } from "~/lib/db.server";
import type { Route } from "./+types/r.$token";

/**
 * `/r/:viewToken` is the fully public compatibility view. The token alone
 * resolves the event; unpublished schedules return the builder's safe empty
 * variant instead of turning a known token into a 404.
 */
export function meta({ data }: Route.MetaArgs) {
  const name = data ? (data.published ? data.data.event.name : data.event.name) : "roster";
  return [{ title: `${name} — シフト表 — roster` }];
}

export async function loader({ context, params }: Route.LoaderArgs) {
  const token = params.token;
  if (!token) throw new Response(null, { status: 404 });

  const db = getDb(context.cloudflare.env);
  const event = await getEventByViewToken(db, token);
  if (!event) throw new Response(null, { status: 404 });

  return buildPublicRosterData(db, event);
}

export default function PublicRosterRoute({ loaderData }: Route.ComponentProps) {
  return <PublicRosterPage loaderData={loaderData} />;
}
