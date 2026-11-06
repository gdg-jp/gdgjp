import {
  Alert,
  Badge,
  Button,
  Card,
  FormField,
  Heading,
  Stack,
  Text,
  Textarea,
} from "@gdgjp/design-system";
import { useState } from "react";
import { Form, Link, useNavigation } from "react-router";
import { ASSET_STATUS_LABELS } from "~/features/assets/asset";
import { getAsset, moveAsset } from "~/features/assets/asset.repository.server";
import { createAndRender } from "~/features/assets/create.server";
import { approveAsset } from "~/features/assets/distribute.server";
import { requireCampaignAccess } from "~/features/campaigns/access.server";
import { CheckResults } from "~/features/drafts/components/CheckResults";
import { constants } from "~/features/playbook/playbook";
import { CampaignLayout } from "~/layouts/CampaignLayout";
import type { Route } from "./+types/detail";

export function meta() {
  return [{ title: "画像 — GDG PR" }];
}

export async function loader({ request, context, params }: Route.LoaderArgs) {
  const env = context.cloudflare.env;
  const access = await requireCampaignAccess(env, request, params.slug);
  const asset = await getAsset(env.DB, access.campaign.id, Number(params.id));
  if (!asset) throw new Response(null, { status: 404 });
  const { campaign } = access;
  return {
    user: { name: access.user.name, email: access.user.email, image: access.user.image },
    accountsUrl: env.ACCOUNTS_URL,
    campaign: {
      slug: campaign.slug,
      name: campaign.name,
      status: campaign.status,
      chapterSlug: campaign.chapterSlug,
    },
    asset,
    canApprove: access.permissions.manage,
    thumbnailScale: constants.render.thumbnailScale,
  };
}

export async function action({ request, context, params }: Route.ActionArgs) {
  const env = context.cloudflare.env;
  const access = await requireCampaignAccess(env, request, params.slug);
  const asset = await getAsset(env.DB, access.campaign.id, Number(params.id));
  if (!asset) throw new Response(null, { status: 404 });
  const form = await request.formData();
  const intent = String(form.get("intent"));
  if (intent === "approve" || intent === "reject") {
    if (!access.permissions.manage)
      return { ok: false as const, error: "承認できるのはリードとオーガナイザーです" };
    if (intent === "reject") {
      await moveAsset(env.DB, asset.id, ["needs_approval", "failed"], "rejected", access.user.id);
      return { ok: true as const, message: "却下しました" };
    }
    const result = await approveAsset(env, access, asset);
    return result.ok
      ? { ok: true as const, message: result.message }
      : { ok: false as const, error: result.error };
  }
  if (intent === "edit") {
    let slots: Record<string, unknown>;
    let layoutVars: Record<string, unknown>;
    try {
      slots = JSON.parse(String(form.get("slots") ?? "{}"));
      layoutVars = JSON.parse(String(form.get("layoutVars") ?? "{}"));
    } catch {
      return { ok: false as const, error: "JSON として読めません" };
    }
    const created = await createAndRender(env, {
      campaignId: access.campaign.id,
      templateId: asset.templateId,
      slots,
      layoutVars,
      skinSource: String(asset.skin.source ?? "gdg-design"),
      author: "human",
      forDraftId: asset.forDraftId,
      forScheduleItemId: asset.forScheduleItemId,
      forImageSlotId: asset.forImageSlotId,
      derivedFromAssetId: asset.id,
    });
    throw new Response(null, {
      status: 303,
      headers: { location: `/c/${access.campaign.slug}/assets/${created.id}` },
    });
  }
  return { ok: false as const, error: "不明な操作です" };
}

const SIZES = ["1x", "縮小", "2x"] as const;

export default function AssetDetail({ loaderData, actionData }: Route.ComponentProps) {
  const { user, accountsUrl, campaign, asset, canApprove, thumbnailScale } = loaderData;
  const busy = useNavigation().state === "submitting";
  const [size, setSize] = useState<(typeof SIZES)[number]>("1x");
  const width =
    size === "1x" ? asset.width : size === "2x" ? asset.width * 2 : asset.width * thumbnailScale;
  return (
    <CampaignLayout
      user={user}
      accountsUrl={accountsUrl}
      campaign={campaign}
      title={`${asset.templateId} #${asset.id}`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={asset.status === "approved" ? "success" : "warning"}>
          {ASSET_STATUS_LABELS[asset.status]}
        </Badge>
        {asset.imgUrl ? <Text tone="muted">{asset.imgUrl}</Text> : null}
        {asset.error ? <Badge tone="danger">{asset.error}</Badge> : null}
        <Link to={`/c/${campaign.slug}/assets`} className="ml-auto text-sm text-link">
          画像一覧へ
        </Link>
      </div>
      {actionData && "error" in actionData && actionData.error ? (
        <Alert tone="danger" title="できませんでした">
          {actionData.error}
        </Alert>
      ) : null}
      {actionData && "message" in actionData && actionData.message ? (
        <Alert tone="success" title="完了">
          {actionData.message}
        </Alert>
      ) : null}
      <div className="grid gap-4 lg:grid-cols-[1fr_24rem]">
        <Card>
          <Stack>
            <div className="flex gap-2">
              {SIZES.map((s) => (
                <Button
                  key={s}
                  type="button"
                  size="sm"
                  variant={size === s ? "primary" : "outline"}
                  onClick={() => setSize(s)}
                >
                  {s}
                </Button>
              ))}
            </div>
            <div className="overflow-auto">
              {asset.r2Key ? (
                <img
                  src={`/c/${campaign.slug}/assets/${asset.id}/image`}
                  alt={asset.templateId}
                  style={{ width, maxWidth: "none" }}
                  className="border border-border"
                />
              ) : (
                <Text tone="muted">画像がありません。</Text>
              )}
            </div>
          </Stack>
        </Card>
        <Card>
          <CheckResults results={asset.checks} />
        </Card>
      </div>
      {asset.status === "needs_approval" && canApprove ? (
        <Form method="post" className="flex gap-2">
          <Button type="submit" name="intent" value="approve" loading={busy}>
            承認して配る
          </Button>
          <Button type="submit" name="intent" value="reject" variant="ghost" loading={busy}>
            却下
          </Button>
        </Form>
      ) : null}
      <Card>
        <Form method="post">
          <Stack>
            <Heading level={2} className="text-lg">
              直して描画し直す
            </Heading>
            <FormField label="スロット（JSON）">
              <Textarea name="slots" rows={8} defaultValue={JSON.stringify(asset.slots, null, 2)} />
            </FormField>
            <FormField
              label="layoutVars（JSON）"
              description="titleScale 0.8〜1.2、align left / center、emphasis は 3 語まで"
            >
              <Textarea
                name="layoutVars"
                rows={3}
                defaultValue={JSON.stringify(asset.layoutVars, null, 2)}
              />
            </FormField>
            <div>
              <Button type="submit" name="intent" value="edit" variant="outline" loading={busy}>
                新しい画像として描画
              </Button>
            </div>
          </Stack>
        </Form>
      </Card>
    </CampaignLayout>
  );
}
