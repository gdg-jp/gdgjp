import { Button, FormField, Inline, Input, PageHeader, Textarea } from "@gdgjp/design-system";
import { Form, useNavigation } from "react-router";
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
        <PageHeader
          className="mb-6"
          title="Edit event"
          back={
            <Button variant="ghost" size="sm" asChild>
              <a href={`/e/${event.id}`}>Cancel</a>
            </Button>
          }
        />
        <p className="mb-6 text-xs text-muted">
          Slots whose day and time stay the same keep their participants' picks. Removed slots drop
          their availability records; added slots start empty.
        </p>
        <Form method="post" className="flex flex-col gap-6">
          <ScheduleEditor initialMinutes={event.slotMinutes} initialDays={initialDays}>
            <FormField id="title" label="Title" required>
              <Input
                id="title"
                name="title"
                required
                maxLength={200}
                defaultValue={event.title}
                placeholder="Team sync"
              />
            </FormField>
            <FormField id="description" label="Description (optional)">
              <Textarea
                id="description"
                name="description"
                maxLength={2000}
                defaultValue={event.description ?? ""}
                placeholder="Anything participants should know."
              />
            </FormField>
          </ScheduleEditor>
          <Inline>
            <Button type="submit" loading={submitting}>
              {submitting ? "Saving…" : "Save changes"}
            </Button>
            <Button variant="ghost" size="md" asChild>
              <a href={`/e/${event.id}`}>Cancel</a>
            </Button>
          </Inline>
        </Form>
      </main>
    </div>
  );
}
