import {
  Alert,
  Badge,
  Button,
  Card,
  Checkbox,
  FormField,
  Heading,
  Input,
  PageHeader,
  RadioGroup,
  RadioGroupItem,
  Stack,
  Text,
} from "@gdgjp/design-system";
import { Form, Link, useNavigation } from "react-router";
import { requireUserWithChapter } from "~/features/auth/access.server";
import { chapterLabel } from "~/features/auth/current-chapter";
import { runnerStatuses } from "~/features/jobs/job.repository.server";
import {
  assistantSettings,
  maskedDiscordWebhook,
  saveAssistantSettings,
  saveDiscordWebhook,
} from "~/features/settings/chapter-settings.server";
import { AppLayout } from "~/layouts/AppLayout";
import type { Route } from "./+types/index";

export function meta() {
  return [{ title: "設定 — GDG PR" }];
}

/** The sidebar chapter's settings. Organizers change them; members see them. */
export async function loader({ request, context }: Route.LoaderArgs) {
  const env = context.cloudflare.env;
  const { user, chapter } = await requireUserWithChapter(env, request);
  const [webhook, assistant, runners] = await Promise.all([
    maskedDiscordWebhook(env, chapter.chapterId),
    assistantSettings(env.DB, chapter.chapterId),
    runnerStatuses(env.DB),
  ]);
  const now = Math.floor(Date.now() / 1000);
  return {
    chapter: chapterLabel(chapter.chapterSlug),
    canManage: chapter.role === "organizer" || user.isAdmin,
    webhook,
    assistant,
    runner: runners[0]
      ? { ago: now - runners[0].last_seen_at, running: !!runners[0].running_job_id }
      : null,
  };
}

export async function action({ request, context }: Route.ActionArgs) {
  const env = context.cloudflare.env;
  const { user, chapter } = await requireUserWithChapter(env, request);
  if (chapter.role !== "organizer" && !user.isAdmin)
    return { ok: false as const, error: "設定を変えられるのはオーガナイザーです" };
  const form = await request.formData();
  const intent = String(form.get("intent"));
  if (intent === "assistant") {
    await saveAssistantSettings(
      env.DB,
      chapter.chapterId,
      {
        mode: form.get("mode") === "suggest" ? "suggest" : "auto",
        morningDigest: form.get("morningDigest") === "on",
      },
      user.id,
    );
    return { ok: true as const, message: "秘書の設定を保存しました" };
  }
  const url = intent === "clear" ? null : String(form.get("webhook") ?? "").trim() || null;
  if (intent === "save" && !url) return { ok: false as const, error: "URL を入れてください" };
  const result = await saveDiscordWebhook(env, chapter.chapterId, url, user.id);
  return result.ok
    ? { ok: true as const, message: url ? "Discord の webhook を保存しました" : "外しました" }
    : { ok: false as const, error: result.error };
}

export default function Settings({ loaderData, actionData }: Route.ComponentProps) {
  const { chapter, canManage, webhook, assistant, runner } = loaderData;
  const busy = useNavigation().state === "submitting";
  return (
    <AppLayout>
      <Stack className="[word-break:auto-phrase]">
        <PageHeader title="設定" description={`${chapter} の設定です。`} />
        {actionData && !actionData.ok ? (
          <Alert tone="danger" title="保存できませんでした">
            {actionData.error}
          </Alert>
        ) : null}
        {actionData?.ok ? <Alert tone="success" title={actionData.message} /> : null}
        <Card>
          <Form method="post">
            <Stack>
              <Heading level={2} className="text-lg">
                秘書
              </Heading>
              <FormField label="自動でやる範囲">
                <RadioGroup name="mode" defaultValue={assistant.mode} disabled={!canManage}>
                  <div className="flex items-start gap-2 text-sm">
                    <RadioGroupItem value="auto" id="mode-auto" />
                    <label htmlFor="mode-auto">
                      下書きまで自動
                      <span className="block text-muted">
                        資料を読んだら計画を作り、投稿やメールの下書きを期限の 7 日前に作ります。
                      </span>
                    </label>
                  </div>
                  <div className="flex items-start gap-2 text-sm">
                    <RadioGroupItem value="suggest" id="mode-suggest" />
                    <label htmlFor="mode-suggest">
                      提案だけ
                      <span className="block text-muted">何かを始める前に、ボタンで聞きます。</span>
                    </label>
                  </div>
                </RadioGroup>
              </FormField>
              <div className="flex items-center gap-2 text-sm">
                <Checkbox
                  id="morning-digest"
                  name="morningDigest"
                  defaultChecked={assistant.morningDigest}
                  disabled={!canManage}
                />
                <label htmlFor="morning-digest">
                  毎朝 9:00 に、今日の予定と返事待ちを Discord に送る
                </label>
              </div>
              <Text tone="muted">
                外へ出すもの（投稿、メール、connpass の更新）は、どちらでも人の承認が要ります。
              </Text>
              {canManage ? (
                <div>
                  <Button type="submit" name="intent" value="assistant" loading={busy}>
                    保存
                  </Button>
                </div>
              ) : null}
            </Stack>
          </Form>
        </Card>
        <Card>
          <Form method="post">
            <Stack>
              <Heading level={2} className="text-lg">
                Discord
              </Heading>
              <Text tone="muted">
                リマインド、レビュー依頼、朝のまとめを送る先です。現在: {webhook ?? "未設定"}
                （URL は暗号化して保存し、画面には出しません）
              </Text>
              {canManage ? (
                <>
                  <FormField label="webhook URL">
                    <Input name="webhook" type="url" autoComplete="off" />
                  </FormField>
                  <div className="flex gap-2">
                    <Button type="submit" name="intent" value="save" loading={busy}>
                      webhook を保存
                    </Button>
                    {webhook ? (
                      <Button type="submit" name="intent" value="clear" variant="ghost">
                        外す
                      </Button>
                    ) : null}
                  </div>
                </>
              ) : null}
            </Stack>
          </Form>
        </Card>
        <Card>
          <Stack>
            <Heading level={2} className="text-lg">
              秘書の稼働
            </Heading>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              {runner ? (
                <Badge tone={runner.ago < 180 ? "success" : "danger"}>
                  {runner.ago < 180 ? "動いています" : `${Math.round(runner.ago / 60)} 分応答なし`}
                </Badge>
              ) : (
                <Badge tone="danger">一度も応答がありません</Badge>
              )}
              {runner?.running ? <span className="text-muted">作業中</span> : null}
              <Link to="/admin/runner" className="text-link">
                詳しく
              </Link>
            </div>
          </Stack>
        </Card>
        {canManage ? (
          <Card>
            <Stack>
              <Heading level={2} className="text-lg">
                Playbook
              </Heading>
              <Text tone="muted">振り返りから出た Playbook への提案を決めて、書き出します。</Text>
              <div>
                <Button asChild variant="outline">
                  <Link to="/playbook/proposals">提案を開く</Link>
                </Button>
              </div>
            </Stack>
          </Card>
        ) : null}
      </Stack>
    </AppLayout>
  );
}
