import {
  Alert,
  Button,
  Card,
  FormField,
  Heading,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Stack,
} from "@gdgjp/design-system";
import { Form, useNavigation } from "react-router";
import { requireCampaignAccess } from "~/features/campaigns/access.server";
import { type CampaignStatus, STATUS_LABELS } from "~/features/campaigns/campaign";
import {
  getCampaignById,
  getCampaignBySlug,
  updateCampaign,
} from "~/features/campaigns/campaign.repository.server";
import { normalizeSlug } from "~/features/campaigns/slug";
import { CampaignLayout } from "~/layouts/CampaignLayout";
import type { Route } from "./+types/settings";

export function meta() {
  return [{ title: "設定 — GDG PR" }];
}

export async function loader({ request, context, params }: Route.LoaderArgs) {
  const env = context.cloudflare.env;
  const access = await requireCampaignAccess(env, request, params.slug);
  const { campaign } = access;
  const parent = campaign.parentCampaignId
    ? (await getCampaignById(env.DB, campaign.parentCampaignId))?.slug
    : null;
  return {
    user: { name: access.user.name, email: access.user.email, image: access.user.image },
    accountsUrl: env.ACCOUNTS_URL,
    campaign: {
      slug: campaign.slug,
      name: campaign.name,
      status: campaign.status,
      chapterSlug: campaign.chapterSlug,
    },
    settings: {
      name: campaign.name,
      status: campaign.status,
      connpassGroupSlug: campaign.connpassGroupSlug ?? "",
      connpassEventId: campaign.connpassEventId ?? "",
      tinyurlCampaignId: campaign.tinyurlCampaignId,
      parent: parent ?? "",
    },
    canManage: access.permissions.manage,
  };
}

export async function action({ request, context, params }: Route.ActionArgs) {
  const env = context.cloudflare.env;
  const access = await requireCampaignAccess(env, request, params.slug, "manage");
  const form = await request.formData();
  const name = String(form.get("name") ?? "").trim();
  if (!name) return { ok: false as const, error: "名前を入れてください" };
  const status = String(form.get("status")) as CampaignStatus;
  if (!(status in STATUS_LABELS)) return { ok: false as const, error: "状態が不正です" };
  const parentRaw = String(form.get("parent") ?? "").trim();
  let parentCampaignId: number | null = null;
  if (parentRaw) {
    const parent = await getCampaignBySlug(env.DB, normalizeSlug(parentRaw) ?? "");
    if (!parent || parent.id === access.campaign.id)
      return { ok: false as const, error: "本番のキャンペーンが見つかりません" };
    parentCampaignId = parent.id;
  }
  await updateCampaign(env.DB, access.campaign.id, {
    name,
    status,
    connpassGroupSlug: String(form.get("connpassGroupSlug") ?? "").trim() || null,
    connpassEventId: String(form.get("connpassEventId") ?? "").trim() || null,
    parentCampaignId,
  });
  return { ok: true as const, error: null };
}

export default function Settings({ loaderData, actionData }: Route.ComponentProps) {
  const { user, accountsUrl, campaign, settings, canManage } = loaderData;
  const navigation = useNavigation();
  return (
    <CampaignLayout user={user} accountsUrl={accountsUrl} campaign={campaign} title="設定">
      {actionData?.error ? (
        <Alert tone="danger" title="保存できませんでした">
          {actionData.error}
        </Alert>
      ) : null}
      {actionData?.ok ? (
        <Alert tone="success" title="保存しました">
          設定を更新しました。
        </Alert>
      ) : null}
      <Card>
        <Form method="post">
          <Stack>
            <Heading level={2} className="text-lg">
              キャンペーン
            </Heading>
            <FormField label="名前" required>
              <Input name="name" defaultValue={settings.name} disabled={!canManage} />
            </FormField>
            <FormField label="状態">
              <Select name="status" defaultValue={settings.status} disabled={!canManage}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(STATUS_LABELS) as CampaignStatus[]).map((s) => (
                    <SelectItem key={s} value={s}>
                      {STATUS_LABELS[s]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
            <FormField label="本番のキャンペーン" description="プレイベントのときだけ">
              <Input name="parent" defaultValue={settings.parent} disabled={!canManage} />
            </FormField>
            <div className="grid gap-4 md:grid-cols-2">
              <FormField
                label="connpass グループ"
                description="connpass.gdgs.jp の allowlist にあるグループ"
              >
                <Input
                  name="connpassGroupSlug"
                  defaultValue={settings.connpassGroupSlug}
                  disabled={!canManage}
                />
              </FormField>
              <FormField label="connpass イベント ID">
                <Input
                  name="connpassEventId"
                  defaultValue={settings.connpassEventId}
                  disabled={!canManage}
                />
              </FormField>
            </div>
            <FormField
              label="url.gdgs.jp のキャンペーン"
              description="有効化すると自動で作られます"
            >
              <Input
                value={settings.tinyurlCampaignId ? String(settings.tinyurlCampaignId) : "未作成"}
                readOnly
              />
            </FormField>
            {canManage ? (
              <div className="flex justify-end">
                <Button type="submit" loading={navigation.state === "submitting"}>
                  保存
                </Button>
              </div>
            ) : null}
          </Stack>
        </Form>
      </Card>
    </CampaignLayout>
  );
}
