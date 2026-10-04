import { getEventByViewToken } from "~/features/events/events.server";
import { PublicRosterPage } from "~/features/public-roster/PublicRosterPage";
import { buildPublicRosterData } from "~/features/public-roster/public-roster.server";
import { getDb } from "~/lib/db.server";
import type { Route } from "./+types/r.$token.s.$sheetId";

/** Public view of one event-owned sheet, authorized by the same event token as `/r/:token`. */
export function meta({ data }: Route.MetaArgs) {
  const event = data?.published ? data.data.event : data?.event;
  return [
    {
      title: event ? `${event.name} — ${event.sheet.name} — シフト表 — roster` : "roster",
    },
  ];
}

export async function loader({ context, params }: Route.LoaderArgs) {
  const token = params.token;
  const sheetId = params.sheetId;
  if (!token || !sheetId) throw new Response(null, { status: 404 });

  const db = getDb(context.cloudflare.env);
  const event = await getEventByViewToken(db, token);
  if (!event) throw new Response(null, { status: 404 });

  // The builder scopes sheet lookup to this event and gates private/deleted sheets before reads.
  return buildPublicRosterData(db, event, sheetId);
}

export default function PublicSheetRosterPage({ loaderData }: Route.ComponentProps) {
  return <PublicRosterPage loaderData={loaderData} />;
}
