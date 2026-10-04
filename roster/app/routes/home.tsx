import { Link } from "react-router";
import { requireUserWithChapter } from "~/features/auth/auth-redirect.server";
import { EventCard, EventStatusBadge } from "~/features/events/components/EventCard";
import { listEventsForChapters } from "~/features/events/events.server";
import { getDb } from "~/lib/db.server";
import type { Route } from "./+types/home";

export function meta() {
  return [{ title: "roster イベント一覧" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const env = context.cloudflare.env;
  const { chapters } = await requireUserWithChapter(env, request);
  const events = await listEventsForChapters(
    getDb(env),
    chapters.map((c) => c.chapterId),
  );
  return { events };
}

/** イベント一覧 (docs/roster/02-domain-schema.md "Design" §6, screen `/`). */
export default function Dashboard({ loaderData }: Route.ComponentProps) {
  const { events } = loaderData;
  return (
    <main className="admin-page">
      <div className="page-heading">
        <div>
          <h1>イベント</h1>
          <p>所属するChapterのスタッフシフトを管理します。</p>
        </div>
        <Link
          to="/events/new"
          className="rounded-md bg-gdg-blue px-4 py-2 text-sm font-semibold text-primary-foreground transition hover:brightness-95"
        >
          イベントを作成
        </Link>
      </div>

      {events.length === 0 ? (
        <p className="text-neutral-600">まだイベントがありません。</p>
      ) : (
        <>
          <div className="hidden overflow-hidden rounded-xl border border-border bg-surface md:block">
            <table className="w-full border-collapse text-left text-sm">
              <thead className="bg-background text-xs text-muted">
                <tr>
                  <th className="px-4 py-3 font-semibold">イベント</th>
                  <th className="px-4 py-3 font-semibold">開催日</th>
                  <th className="px-4 py-3 font-semibold">時間</th>
                  <th className="px-4 py-3 font-semibold">状態</th>
                  <th className="px-4 py-3">
                    <span className="sr-only">操作</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {events.map((event) => (
                  <tr key={event.id} className="border-t border-border">
                    <td className="px-4 py-3 font-semibold">{event.name}</td>
                    <td className="px-4 py-3 whitespace-nowrap">{event.date}</td>
                    <td className="px-4 py-3 whitespace-nowrap text-muted">
                      {event.startTime}–{event.endTime}
                    </td>
                    <td className="px-4 py-3">
                      <EventStatusBadge status={event.status} />
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Link
                        to={`/e/${event.id}`}
                        className="rounded-md border border-border px-3 py-1.5 font-semibold hover:bg-background"
                      >
                        開く
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ul className="space-y-3 md:hidden">
            {events.map((event) => (
              <EventCard key={event.id} event={event} />
            ))}
          </ul>
        </>
      )}
    </main>
  );
}
