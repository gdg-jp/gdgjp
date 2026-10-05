import { Button, FormField, Input, PageHeader, Textarea } from "@gdgjp/design-system";
import { Form, useNavigation } from "react-router";
import { ScheduleEditor } from "~/features/scheduling/components/schedule-editor";
import { Header } from "~/layouts/header";

import { getOptionalUser } from "~/features/auth/auth-redirect.server";
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
  const nav = useNavigation();
  const submitting = nav.state === "submitting" && nav.formAction === "/events/new";

  return (
    <div className="min-h-dvh">
      <Header user={loaderData.user} />
      <main className="mx-auto max-w-5xl px-4 py-6">
        <PageHeader
          className="mb-6"
          title="Schedule a meeting"
          description="Set when meetings could happen and how long they should be. Share the URL — participants pick the times that work."
        />
        <Form method="post" action="/events/new" className="flex flex-col gap-6">
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
          <div>
            <Button type="submit" loading={submitting}>
              {submitting ? "Creating…" : "Create event"}
            </Button>
          </div>
        </Form>
      </main>
    </div>
  );
}
