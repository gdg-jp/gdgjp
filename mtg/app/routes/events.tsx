import { Link } from "react-router";
import { Header } from "~/components/header";
import { Button } from "~/components/ui/button";
import { requireUser } from "~/lib/auth-redirect.server";
import { listEventsForUser } from "~/lib/db";
import type { Route } from "./+types/events";

export function meta() {
  return [{ title: "My events — Scheduler" }];
}

export async function loader(args: Route.LoaderArgs) {
  const env = args.context.cloudflare.env;
  const user = await requireUser(env, args.request);
  const events = await listEventsForUser(env.DB, user.id);
  return { user: { name: user.name, email: user.email }, events };
}

export default function MyEvents({ loaderData }: Route.ComponentProps) {
  const { user, events } = loaderData;
  return (
    <div className="min-h-dvh">
      <Header user={user} />
      <main className="mx-auto max-w-3xl px-4 py-8">
        <div className="mb-4 flex items-center justify-between">
          <h1 className="text-2xl font-semibold tracking-tight">My events</h1>
          <Button asChild>
            <Link to="/">New event</Link>
          </Button>
        </div>
        {events.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No events yet.{" "}
            <Link to="/" className="underline">
              Create one
            </Link>
            .
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {events.map(({ event, slotCount, participantCount }) => (
              <li
                key={event.id}
                className="rounded-md border p-3 transition-colors hover:bg-muted/50"
              >
                <Link to={`/e/${event.id}`} className="flex flex-col gap-1">
                  <span className="font-medium">{event.title}</span>
                  <span className="text-xs text-muted-foreground">
                    {slotCount} slot{slotCount === 1 ? "" : "s"} · {participantCount} participant
                    {participantCount === 1 ? "" : "s"} ·{" "}
                    {new Date(event.createdAt * 1000).toLocaleDateString()}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}
