import { PageHeader, Stack } from "@gdgjp/ui";
import { requireUserWithChapter } from "~/features/auth/auth-redirect.server";
import { canManageEvent } from "~/features/auth/permissions";
import { ShareCard, SheetShareList } from "~/features/events/components/ShareCard";
import { getEvent } from "~/features/events/events.server";
import { listRosterSheets } from "~/features/roster-sheets/roster-sheets.server";
import { getDb } from "~/lib/db.server";
import type { Route } from "./+types/e.$id.share";

/**
 * `/e/:id/share` (docs/roster/09-share-public-views.md "Design" §1):
 * chapter-gated exactly like `/e/:id/design`/`/e/:id/staff`/`/e/:id/roster`
 * — the same `requireUserWithChapter` + `canManageEvent` pattern every other
 * owner route in this app uses. This route does not change `status`; it
 * surfaces the default compatibility URL and each live sheet's visibility and public URL.
 * Publication is managed on the event overview, independently of recruitment.
 */
async function requireShareAccess(env: Env, request: Request, id: string | undefined) {
  const { chapters } = await requireUserWithChapter(env, request);
  if (!id) throw new Response(null, { status: 404 });
  const event = await getEvent(getDb(env), id);
  if (!event) throw new Response(null, { status: 404 });
  if (!canManageEvent(chapters, event)) throw new Response("Forbidden", { status: 403 });
  return { event };
}

export function meta({ data }: Route.MetaArgs) {
  return [{ title: data ? `${data.event.name} — 共有 — roster` : "roster" }];
}

export async function loader({ request, context, params }: Route.LoaderArgs) {
  const env = context.cloudflare.env;
  const { event } = await requireShareAccess(env, request, params.id);
  const sheets = await listRosterSheets(getDb(env), event.id);
  return {
    event: { id: event.id, name: event.name, status: event.status },
    viewUrl: `${env.APP_URL}/r/${event.viewToken}`,
    defaultVisibility:
      sheets.find(({ id }) => id === `default:${event.id}`)?.visibility ?? "private",
    sheets: sheets.map(({ id, name, date, startTime, endTime, visibility }) => ({
      id,
      name,
      date,
      startTime,
      endTime,
      visibility,
      isDefault: id === `default:${event.id}`,
      viewUrl: `${env.APP_URL}/r/${event.viewToken}/s/${id}`,
    })),
  };
}

export default function SharePage({ loaderData }: Route.ComponentProps) {
  const { event, viewUrl, sheets, defaultVisibility } = loaderData;

  return (
    <main className="admin-page admin-page-narrow">
      <Stack>
        <PageHeader title="共有" description={`${event.name} · 閲覧専用URL`} />
        <ShareCard viewUrl={viewUrl} visibility={defaultVisibility} />
        <SheetShareList sheets={sheets} />
      </Stack>
    </main>
  );
}
