import { Alert, Button, Card, FormField, Stack, Text, Textarea } from "@gdgjp/design-system";
import { Form, useNavigation } from "react-router";
import { type Brief, emptyBrief, parseBrief } from "~/features/briefs/brief";
import { briefFromForm } from "~/features/briefs/brief-form";
import { latestBrief, saveBrief } from "~/features/briefs/brief.repository.server";
import { BriefForm } from "~/features/briefs/components/BriefForm";
import { requireCampaignAccess } from "~/features/campaigns/access.server";
import { toJstLocal } from "~/features/schedule/calendar";
import { CampaignLayout } from "~/layouts/CampaignLayout";
import type { Route } from "./+types/edit";

export function meta() {
  return [{ title: "brief — GDG PR" }];
}

export async function loader({ request, context, params }: Route.LoaderArgs) {
  const env = context.cloudflare.env;
  const access = await requireCampaignAccess(env, request, params.slug);
  const stored = await latestBrief(env.DB, access.campaign.id);
  const { campaign } = access;
  const brief =
    stored?.brief ??
    emptyBrief(
      campaign.name,
      campaign.eventAt ? `${toJstLocal(campaign.eventAt)}:00+09:00` : null,
      campaign.venue,
    );
  return {
    user: { name: access.user.name, email: access.user.email, image: access.user.image },
    accountsUrl: env.ACCOUNTS_URL,
    campaign: {
      slug: campaign.slug,
      name: campaign.name,
      status: campaign.status,
      chapterSlug: campaign.chapterSlug,
    },
    brief,
    version: stored?.version ?? 0,
    canEdit: access.permissions.manage,
  };
}

export async function action({ request, context, params }: Route.ActionArgs) {
  const env = context.cloudflare.env;
  const access = await requireCampaignAccess(env, request, params.slug, "manage");
  const form = await request.formData();
  const previous = (await latestBrief(env.DB, access.campaign.id))?.brief ?? null;
  let candidate: unknown;
  if (form.get("intent") === "json") {
    try {
      candidate = JSON.parse(String(form.get("json") ?? ""));
    } catch {
      return { ok: false as const, errors: ["JSON として読めません"] };
    }
  } else {
    candidate = briefFromForm(form, previous);
  }
  const parsed = parseBrief(candidate);
  if (!parsed.ok) return { ok: false as const, errors: parsed.errors };
  const version = await saveBrief(env.DB, access.campaign.id, parsed.brief, access.user.id);
  return { ok: true as const, version };
}

export default function BriefEdit({ loaderData, actionData }: Route.ComponentProps) {
  const { user, accountsUrl, campaign, brief, version, canEdit } = loaderData;
  const navigation = useNavigation();
  const saving = navigation.state === "submitting";
  return (
    <CampaignLayout user={user} accountsUrl={accountsUrl} campaign={campaign} title="brief">
      <Text tone="muted">
        {version ? `版 ${version}。保存するたびに新しい版になります。` : "まだ保存していません。"}
        計画・コピー・投稿の下書きはすべてこの brief から作ります。
      </Text>
      {actionData && !actionData.ok ? (
        <Alert tone="danger" title="保存できませんでした">
          <ul className="list-disc pl-5">
            {actionData.errors.slice(0, 12).map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </Alert>
      ) : null}
      {actionData?.ok ? (
        <Alert tone="success" title={`版 ${actionData.version} を保存しました`}>
          brief を更新しました。
        </Alert>
      ) : null}
      {!canEdit ? (
        <Alert tone="info" title="閲覧のみ">
          brief を編集できるのは、リードと主催チャプターのオーガナイザーです。
        </Alert>
      ) : null}
      <Form method="post" key={version}>
        <Stack>
          <BriefForm brief={brief as Brief} disabled={!canEdit} />
          {canEdit ? (
            <div className="flex justify-end">
              <Button type="submit" name="intent" value="form" loading={saving}>
                保存
              </Button>
            </div>
          ) : null}
        </Stack>
      </Form>
      {canEdit ? (
        <Card>
          <Form method="post">
            <Stack>
              <FormField
                label="JSON で読み込む"
                description="brief.schema.json の形の JSON を貼り付けると、そのまま新しい版にします。"
              >
                <Textarea name="json" rows={4} />
              </FormField>
              <div className="flex justify-end">
                <Button type="submit" name="intent" value="json" variant="outline" loading={saving}>
                  JSON を読み込む
                </Button>
              </div>
            </Stack>
          </Form>
        </Card>
      ) : null}
    </CampaignLayout>
  );
}
