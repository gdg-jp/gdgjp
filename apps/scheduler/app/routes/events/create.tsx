import { Alert, Button, FormField, Input, PageHeader, Textarea } from "@gdgjp/design-system";
import { useFetcher } from "react-router";
import { getOptionalUser } from "~/features/auth/auth-redirect.server";
import type { createEvent } from "~/features/events/manage.server";
import { ScheduleEditor } from "~/features/scheduling/components/schedule-editor";
import { Header } from "~/layouts/header";
import type { Route } from "./+types/create";

export function meta() {
  return [
    { title: "Scheduler — Schedule a meeting" },
    {
      name: "description",
      content: "Create a meeting and let participants pick the times that work.",
    },
  ];
}

export async function loader(args: Route.LoaderArgs) {
  const env = args.context.cloudflare.env;
  const user = await getOptionalUser(env, args.request);
  return {
    user: user ? { name: user.name, email: user.email, image: user.image } : null,
  };
}

export default function HomePage({ loaderData }: Route.ComponentProps) {
  const fetcher = useFetcher<typeof createEvent>();
  const submitting = fetcher.state !== "idle";
  const errors = fetcher.data?.errors;

  return (
    <div className="min-h-dvh">
      <Header user={loaderData.user} />
      <main className="mx-auto max-w-5xl px-4 py-6">
        <PageHeader
          className="mb-6"
          title="Schedule a meeting"
          description="Set when meetings could happen and how long they should be. Share the URL — participants pick the times that work."
        />
        <fetcher.Form method="post" action="/events/new" className="flex flex-col gap-6">
          <ScheduleEditor>
            <FormField id="title" label="Title" required>
              <Input id="title" name="title" required maxLength={200} placeholder="Team sync" />
            </FormField>
            <FormField id="description" label="Description (optional)">
              <Textarea
                id="description"
                name="description"
                maxLength={2000}
                placeholder="Anything participants should know."
              />
            </FormField>
          </ScheduleEditor>
          {errors ? (
            <Alert tone="danger" title="The event was not created">
              <ul className="list-disc pl-5">
                {errors.map((error) => (
                  <li key={error}>{error}</li>
                ))}
              </ul>
            </Alert>
          ) : null}
          <div>
            <Button type="submit" loading={submitting}>
              {submitting ? "Creating…" : "Create event"}
            </Button>
          </div>
        </fetcher.Form>
      </main>
    </div>
  );
}
