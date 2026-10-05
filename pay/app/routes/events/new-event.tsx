import { Alert, Button, Card, FormField, Input, PageHeader } from "@gdgjp/design-system";
import { Form, Link } from "react-router";
import { Header } from "~/layouts/header";

import { redirect } from "react-router";

import { requireMember } from "~/features/auth/session.server";
import { createEvent } from "~/features/events/repository.server";
import type { Route } from "./+types/new-event";

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
      <main className="mx-auto max-w-xl space-y-6 px-4 py-6 sm:py-8">
        <PageHeader
          back={
            <Link to="/" className="text-sm text-link hover:underline">
              イベント一覧
            </Link>
          }
          title="イベントを登録"
          description={
            <>
              {" "}
              作成者の所属チャプター Organizer が代行登録できます。現在の所属:{" "}
              {chapters.map((c) => c.slug).join(", ")}{" "}
            </>
          }
        />
        {actionData && "error" in actionData ? (
          <Alert tone="danger" title={actionData.error} />
        ) : null}
        <Card>
          <Form method="post" className="space-y-4">
            <FormField id="title" label="イベント名" required>
              <Input name="title" required placeholder="例: Innovative Crosstalk 26" />
            </FormField>
            <Button type="submit">作成する</Button>
          </Form>
        </Card>
      </main>
    </div>
  );
}
