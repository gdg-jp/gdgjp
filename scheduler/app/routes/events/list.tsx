import { Button, Card, EmptyState, PageHeader } from "@gdgjp/design-system";
import { Link } from "react-router";
import { Header } from "~/layouts/header";

import { loadOwnedEvents } from "~/features/events/manage.server";
import type { Route } from "./+types/list";

export function meta() {
  return [{ title: "My events — Scheduler" }];
}

export function loader(args: Route.LoaderArgs) {
  return loadOwnedEvents(args.context.cloudflare.env, args.request);
}

export default function MyEventsPage({ loaderData }: Route.ComponentProps) {
  const { user, events } = loaderData;
  return (
    <div className="min-h-dvh">
      <Header user={user} />
      <main className="mx-auto max-w-3xl px-4 py-8">
        <PageHeader
          className="mb-6"
          title="My events"
          actions={
            <Button asChild>
              <Link to="/">New event</Link>
            </Button>
          }
        />
        {events.length === 0 ? (
          <EmptyState
            title="No events yet"
            description="Create a meeting to start gathering availability."
          />
        ) : (
          <ul className="flex flex-col gap-2">
            {events.map(({ event, slotCount, participantCount }) => (
              <li key={event.id} className="min-w-0">
                <Card>
                  <Link to={`/e/${event.id}`} className="flex flex-col gap-1 break-words">
                    <span className="font-medium">{event.title}</span>
                    <span className="text-xs text-muted">
                      {slotCount} slot{slotCount === 1 ? "" : "s"} · {participantCount} participant
                      {participantCount === 1 ? "" : "s"} ·{" "}
                      {new Date(event.createdAt * 1000).toLocaleDateString()}
                    </span>
                  </Link>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}
