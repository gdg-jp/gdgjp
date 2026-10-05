import { Icons } from "@gdgjp/design-system";
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
      <div className="page-heading brand-hero">
        <div>
          <span className="brand-eyebrow">GDG ON CAMPUS / ROSTER</span>
          <h1>イベント</h1>
          <p>所属するChapterのスタッフシフトを管理します。</p>
        </div>
        <Link to="/events/new" className="brand-action">
          <Icons name="Plus" size={18} aria-hidden="true" /> イベントを作成
        </Link>
      </div>

      {events.length === 0 ? (
        <div className="brand-empty">
          <span className="brand-eyebrow">01 / START HERE</span>
          <h2>最初のイベントを作成</h2>
          <p>イベントを追加すると、シフト表を作成してスタッフの配置を始められます。</p>
          <Link to="/events/new" className="brand-action">
            イベントを作成 <Icons name="ArrowUpRight" size={18} aria-hidden="true" />
          </Link>
        </div>
      ) : (
        <>
          <div className="brand-section-heading">
            <span className="brand-eyebrow">YOUR EVENTS</span>
            <span>{events.length} EVENTS</span>
          </div>
          <ul className="event-card-grid">
            {events.map((event) => (
              <EventCard key={event.id} event={event} />
            ))}
          </ul>
        </>
      )}
    </main>
  );
}
