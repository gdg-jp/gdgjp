import { Form, useNavigation } from "react-router";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Textarea } from "~/components/ui/textarea";
import { ScheduleEditor } from "~/features/scheduling/components/schedule-editor";
import { Header } from "~/layouts/header";

import { editEvent, loadOwnedEvent } from "~/features/events/manage.server";
import type { Route } from "./+types/edit";

export function meta({ data }: Route.MetaArgs) {
  return [
    { title: data?.event ? `Edit ${data.event.title} — Scheduler` : "Edit event — Scheduler" },
  ];
}

export function loader(args: Route.LoaderArgs) {
  return loadOwnedEvent(args.context.cloudflare.env, args.request, args.params.id);
}

export function action(args: Route.ActionArgs) {
  return editEvent(args.context.cloudflare.env, args.request, args.params.id);
}

export default function EditEventPage({ loaderData }: Route.ComponentProps) {
  const { user, event, initialDays } = loaderData;
  const nav = useNavigation();
  const submitting = nav.state === "submitting" && nav.formAction === `/e/${event.id}/edit`;

  return (
    <div className="min-h-dvh">
      <Header user={user} />
      <main className="mx-auto max-w-5xl px-4 py-8">
        <div className="mb-6 flex items-center justify-between">
          <h1 className="text-2xl font-semibold tracking-tight">Edit event</h1>
          <Button variant="ghost" size="sm" asChild>
            <a href={`/e/${event.id}`}>Cancel</a>
          </Button>
        </div>
        <p className="mb-6 text-xs text-muted-foreground">
          Slots whose day and time stay the same keep their participants' picks. Removed slots drop
          their availability records; added slots start empty.
        </p>
        <Form method="post" className="flex flex-col gap-6">
          <ScheduleEditor initialMinutes={event.slotMinutes} initialDays={initialDays}>
            <div className="flex flex-col gap-2">
              <Label htmlFor="title">Title</Label>
              <Input
                id="title"
                name="title"
                required
                maxLength={200}
                defaultValue={event.title}
                placeholder="Team sync"
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="description">Description (optional)</Label>
              <Textarea
                id="description"
                name="description"
                maxLength={2000}
                defaultValue={event.description ?? ""}
                placeholder="Anything participants should know."
              />
            </div>
          </ScheduleEditor>
          <div className="flex gap-2">
            <Button type="submit" disabled={submitting}>
              {submitting ? "Saving…" : "Save changes"}
            </Button>
            <Button variant="ghost" size="default" asChild>
              <a href={`/e/${event.id}`}>Cancel</a>
            </Button>
          </div>
        </Form>
      </main>
    </div>
  );
}
