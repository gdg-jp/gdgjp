import { Form, useNavigation } from "react-router";
import { Header } from "~/components/header";
import { ScheduleEditor } from "~/components/schedule-editor";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Textarea } from "~/components/ui/textarea";
import { getOptionalUser } from "~/lib/auth-redirect.server";
import type { Route } from "./+types/home";

export function meta() {
  return [
    { title: "mtg — Schedule a meeting" },
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
    user: user ? { name: user.name, email: user.email } : null,
  };
}

export default function Home({ loaderData }: Route.ComponentProps) {
  const nav = useNavigation();
  const submitting = nav.state === "submitting" && nav.formAction === "/events/new";

  return (
    <div className="min-h-dvh">
      <Header user={loaderData.user} />
      <main className="mx-auto max-w-3xl px-4 py-8">
        <div className="mb-6">
          <h1 className="text-2xl font-semibold tracking-tight">Schedule a meeting</h1>
          <p className="text-sm text-muted-foreground">
            Set when meetings could happen and how long they should be. Share the URL — participants
            pick the times that work.
          </p>
        </div>
        <Form method="post" action="/events/new" className="flex flex-col gap-6">
          <div className="flex flex-col gap-2">
            <Label htmlFor="title">Title</Label>
            <Input id="title" name="title" required maxLength={200} placeholder="Team sync" />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="description">Description (optional)</Label>
            <Textarea
              id="description"
              name="description"
              maxLength={2000}
              placeholder="Anything participants should know."
            />
          </div>
          <ScheduleEditor />
          <div>
            <Button type="submit" disabled={submitting}>
              {submitting ? "Creating…" : "Create event"}
            </Button>
          </div>
        </Form>
      </main>
    </div>
  );
}
