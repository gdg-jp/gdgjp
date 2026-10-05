import { Icons } from "@gdgjp/design-system";
import { Link } from "react-router";
import type { EventRecord } from "~/features/events/events.server";
import { STATUS_LABELS } from "~/features/events/status";

/** One event's summary row in the `/` list (docs/roster/02-domain-schema.md "Design" §6). */
export function EventCard({ event }: { event: EventRecord }) {
  return (
    <li className="event-card">
      <div className="event-card-art" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
      <div className="event-card-body">
        <div className="event-card-meta">
          <span className="brand-eyebrow">EVENT / {event.date}</span>
          <EventStatusBadge status={event.status} />
        </div>
        <h2>
          <Link to={`/e/${event.id}`}>
            {event.name}
            <Icons name="ArrowUpRight" size={21} aria-hidden="true" />
          </Link>
        </h2>
        <p>
          {event.startTime}–{event.endTime}
        </p>
      </div>
    </li>
  );
}

export function EventStatusBadge({ status }: { status: EventRecord["status"] }) {
  return (
    <span className="event-status-badge" data-status={status}>
      {STATUS_LABELS[status]}
    </span>
  );
}
