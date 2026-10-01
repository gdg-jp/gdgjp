import { Badge, Card, Heading, Inline, Link, PageHeader, Stack } from "@gdgjp/ui";
import { Link as RouterLink } from "react-router";
import { requireUserWithChapter } from "~/features/auth/auth-redirect.server";
import { canManageEvent } from "~/features/auth/permissions";
import { getEvent } from "~/features/events/events.server";
import { listRosterSheets } from "~/features/roster-sheets/roster-sheets.server";
import { getDb } from "~/lib/db.server";
import type { Route } from "./+types/e.$id";

export function meta({ data }: Route.MetaArgs) {
  return [{ title: data ? `${data.event.name} — シフト一覧 — roster` : "roster" }];
}

export async function loader({ request, context, params }: Route.LoaderArgs) {
  const env = context.cloudflare.env;
  const { chapters } = await requireUserWithChapter(env, request);
  if (!params.id) throw new Response(null, { status: 404 });

  const db = getDb(env);
  const event = await getEvent(db, params.id);
  if (!event) throw new Response(null, { status: 404 });
  if (!canManageEvent(chapters, event)) throw new Response("Forbidden", { status: 403 });

  const sheets = await listRosterSheets(db, event.id);
  return {
    event: { id: event.id, name: event.name },
    sheets: sheets.map(({ id, name, date, startTime, endTime, visibility }) => ({
      id,
      name,
      date,
      startTime,
      endTime,
      visibility,
    })),
  };
}

export default function EventOverview({ loaderData }: Route.ComponentProps) {
  const { event, sheets } = loaderData;

  return (
    <main className="admin-page">
      <PageHeader
        title={event.name}
        description="開催するシフト表を選択してください。"
        actions={
          <>
            <Link asChild>
              <RouterLink to={`/e/${event.id}/staff`}>スタッフ</RouterLink>
            </Link>
            <Link asChild>
              <RouterLink to={`/e/${event.id}/share`}>共有</RouterLink>
            </Link>
          </>
        }
      />

      <p className="gdg-muted text-sm">シフト表ごとの設計・管理画面は準備中です。</p>

      {sheets.length === 0 ? (
        <output className="gdg-muted">シフト表はまだありません。</output>
      ) : (
        <ul className="grid list-none grid-cols-1 gap-4 p-0 md:grid-cols-2 xl:grid-cols-3">
          {sheets.map((sheet) => (
            <li key={sheet.id}>
              <Card>
                <Stack>
                  <Inline className="items-start justify-between">
                    <Heading level={2} className="min-w-0 break-words">
                      {sheet.name}
                    </Heading>
                    <Badge tone={sheet.visibility === "published" ? "success" : "neutral"}>
                      {sheet.visibility === "published" ? "公開" : "非公開"}
                    </Badge>
                  </Inline>
                  <p className="gdg-muted text-sm">
                    <time dateTime={sheet.date}>{sheet.date}</time>
                    <span aria-hidden="true"> · </span>
                    <time dateTime={`${sheet.date}T${sheet.startTime}`}>{sheet.startTime}</time>
                    <span aria-hidden="true">–</span>
                    <time dateTime={`${sheet.date}T${sheet.endTime}`}>{sheet.endTime}</time>
                  </p>
                </Stack>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
