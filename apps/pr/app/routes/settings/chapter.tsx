import {
  Alert,
  Button,
  Card,
  FormField,
  Heading,
  Input,
  PageHeader,
  Stack,
  Text,
} from "@gdgjp/design-system";
import { Form, useNavigation } from "react-router";
import { requireUserWithChapter } from "~/features/auth/access.server";
import {
  maskedDiscordWebhook,
  saveDiscordWebhook,
} from "~/features/settings/chapter-settings.server";
import { AppLayout } from "~/layouts/AppLayout";
import type { Route } from "./+types/chapter";

export function meta() {
  return [{ title: "チャプター設定 — GDG PR" }];
}

/** Organizers set their own chapter's Discord webhook (co-hosts set theirs on their own). */
export async function loader({ request, context }: Route.LoaderArgs) {
  const env = context.cloudflare.env;
  const { user, chapters } = await requireUserWithChapter(env, request);
  const organized = chapters.filter((c) => c.role === "organizer" || user.isAdmin);
  return {
    user: { name: user.name, email: user.email, image: user.image },
    accountsUrl: env.ACCOUNTS_URL,
    chapters: await Promise.all(
      organized.map(async (c) => ({
        id: c.chapterId,
        slug: c.chapterSlug,
        webhook: await maskedDiscordWebhook(env, c.chapterId),
      })),
    ),
  };
}

export async function action({ request, context }: Route.ActionArgs) {
  const env = context.cloudflare.env;
  const { user, chapters } = await requireUserWithChapter(env, request);
  const form = await request.formData();
  const chapterId = Number(form.get("chapter"));
  const chapter = chapters.find((c) => c.chapterId === chapterId);
  if (!chapter || (chapter.role !== "organizer" && !user.isAdmin))
    return { ok: false as const, error: "そのチャプターのオーガナイザーだけが設定できます" };
  const url = form.get("intent") === "clear" ? null : String(form.get("webhook") ?? "").trim();
  if (url === "") return { ok: false as const, error: "URL を入れてください" };
  const result = await saveDiscordWebhook(env, chapterId, url, user.id);
  return result.ok
    ? { ok: true as const, error: null }
    : { ok: false as const, error: result.error };
}

export default function ChapterSettings({ loaderData, actionData }: Route.ComponentProps) {
  const { user, accountsUrl, chapters } = loaderData;
  const busy = useNavigation().state === "submitting";
  return (
    <AppLayout user={user} accountsUrl={accountsUrl}>
      <PageHeader title="チャプター設定" description="リマインドとレビュー依頼を送る Discord" />
      {actionData?.error ? (
        <Alert tone="danger" title="保存できませんでした">
          {actionData.error}
        </Alert>
      ) : null}
      {actionData?.ok ? (
        <Alert tone="success" title="保存しました">
          Discord の webhook を更新しました。
        </Alert>
      ) : null}
      {chapters.length === 0 ? (
        <Text tone="muted">オーガナイザーを務めるチャプターがありません。</Text>
      ) : null}
      {chapters.map((c) => (
        <Card key={c.id}>
          <Form method="post">
            <Stack>
              <Heading level={2} className="text-lg">
                {c.slug}
              </Heading>
              <Text tone="muted">
                現在: {c.webhook ?? "未設定"}（URL は暗号化して保存し、画面には出しません）
              </Text>
              <input type="hidden" name="chapter" value={c.id} />
              <FormField label="Discord の webhook URL">
                <Input name="webhook" type="url" autoComplete="off" />
              </FormField>
              <div className="flex gap-2">
                <Button type="submit" name="intent" value="save" loading={busy}>
                  保存
                </Button>
                {c.webhook ? (
                  <Button type="submit" name="intent" value="clear" variant="ghost" loading={busy}>
                    外す
                  </Button>
                ) : null}
              </div>
            </Stack>
          </Form>
        </Card>
      ))}
    </AppLayout>
  );
}
