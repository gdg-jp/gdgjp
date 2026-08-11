import { Form, redirect } from "react-router";
import { Header } from "~/components/header";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { requireMember } from "~/lib/auth-redirect.server";
import { createEvent } from "~/lib/db.server";
import type { Route } from "./+types/events.new";

export function meta() {
  return [{ title: "イベント登録 — GDG Japan Pay" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const { user, chapters } = await requireMember(context.cloudflare.env, request);
  return {
    user,
    chapters: chapters.map((c) => ({ id: c.chapterId, slug: c.chapterSlug, role: c.role })),
  };
}

export async function action({ request, context }: Route.ActionArgs) {
  const env = context.cloudflare.env;
  const { user, chapters } = await requireMember(env, request);
  const form = await request.formData();
  const title = String(form.get("title") ?? "").trim();
  if (!title) return { error: "イベント名を入力してください" };
  const event = await createEvent(env.DB, {
    title,
    ownerUserId: user.id,
    ownerChapterIds: chapters.map((chapter) => chapter.chapterId),
  });
  return redirect(`/events/${event.id}`);
}

export default function NewEventPage({ loaderData, actionData }: Route.ComponentProps) {
  const { user, chapters } = loaderData;
  return (
    <div className="min-h-dvh bg-background">
      <Header user={{ name: user.name, email: user.email, image: user.image }} />
      <main className="mx-auto max-w-xl space-y-6 px-4 py-10">
        <div>
          <h1 className="text-2xl font-semibold">イベントを登録</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            作成者の所属チャプター Organizer が代行登録できます。現在の所属:{" "}
            {chapters.map((c) => c.slug).join(", ")}
          </p>
        </div>
        {actionData && "error" in actionData ? (
          <p className="text-sm text-destructive">{actionData.error}</p>
        ) : null}
        <Form method="post" className="space-y-4 rounded-xl border p-5">
          <div className="space-y-2">
            <Label htmlFor="title">イベント名</Label>
            <Input id="title" name="title" required placeholder="例: Innovative Crosstalk 26" />
          </div>
          <Button type="submit">作成する</Button>
        </Form>
      </main>
    </div>
  );
}
