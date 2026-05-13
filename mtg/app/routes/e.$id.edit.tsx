import { Form, redirect, useNavigation } from "react-router";
import { Header } from "~/components/header";
import { ScheduleEditor } from "~/components/schedule-editor";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Textarea } from "~/components/ui/textarea";
import { requireUser } from "~/lib/auth-redirect.server";
import { getEventBundle, updateEventForOwner } from "~/lib/db";
import { deriveDayRanges } from "~/lib/slots";
import { parseEventForm } from "~/lib/validate";
import type { Route } from "./+types/e.$id.edit";

export function meta({ data }: Route.MetaArgs) {
  return [
    { title: data?.event ? `Edit ${data.event.title} — Scheduler` : "Edit event — Scheduler" },
  ];
}

export async function loader(args: Route.LoaderArgs) {
  const env = args.context.cloudflare.env;
  const user = await requireUser(env, args.request);
  const bundle = await getEventBundle(env.DB, args.params.id);
  if (!bundle) throw new Response("Not found", { status: 404 });
  if (bundle.event.ownerUserId !== user.id) {
    throw new Response("Forbidden", { status: 403 });
  }
  return {
    user: { name: user.name, email: user.email },
    event: bundle.event,
    initialDays: deriveDayRanges(bundle.slots, bundle.event.slotMinutes),
  };
}

export async function action(args: Route.ActionArgs) {
  const env = args.context.cloudflare.env;
  const user = await requireUser(env, args.request);
  const form = await args.request.formData();
  const parsed = parseEventForm(form);
  if (!parsed.ok) {
    return new Response(parsed.errors.join("\n"), { status: 400 });
  }
  const result = await updateEventForOwner(env.DB, args.params.id, user.id, {
    title: parsed.value.title,
    description: parsed.value.description,
    slotMinutes: parsed.value.slotMinutes,
    slots: parsed.value.slots,
  });
  if (!result) throw new Response("Not found", { status: 404 });
  throw redirect(`/e/${args.params.id}`);
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
