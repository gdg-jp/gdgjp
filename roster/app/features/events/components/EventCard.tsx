import { Link } from "react-router";
import type { EventRecord } from "~/features/events/events.server";
import { STATUS_LABELS } from "~/features/events/status";

const STATUS_BADGE_COLOR: Record<EventRecord["status"], string> = {
  draft: "bg-neutral-200 text-neutral-700",
  open: "bg-gdg-green/20 text-gdg-green",
  closed: "bg-gdg-yellow/20 text-neutral-800",
  published: "bg-gdg-blue/20 text-gdg-blue",
  ended: "bg-neutral-200 text-neutral-500",
};

/** One event's summary row in the `/` list (docs/roster/02-domain-schema.md "Design" §6). */
export function EventCard({ event }: { event: EventRecord }) {
  return (
    <li className="rounded-xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link to={`/e/${event.id}`} className="font-semibold hover:text-gdg-blue">
          {event.name}
        </Link>
        <EventStatusBadge status={event.status} />
      </div>
      <p className="mt-1 text-sm text-neutral-600">
        {event.date} {event.startTime}–{event.endTime}
      </p>
    </li>
  );
}

export function EventStatusBadge({ status }: { status: EventRecord["status"] }) {
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_BADGE_COLOR[status]}`}
    >
      {STATUS_LABELS[status]}
    </span>
  );
}
