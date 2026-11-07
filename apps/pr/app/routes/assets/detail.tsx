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
import { ASSET_STATUS_LABELS, TEMPLATE_LABELS } from "~/features/assets/asset";
import { adoptKit, getAsset, moveAsset } from "~/features/assets/asset.repository.server";
import { createAndRender } from "~/features/assets/create.server";
import { approveAsset } from "~/features/assets/distribute.server";
import { requireCampaignAccess } from "~/features/campaigns/access.server";
import { CheckResults } from "~/features/drafts/components/CheckResults";
import { EnqueueError, enqueueAsset } from "~/features/jobs/enqueue.server";
import { recordEdits } from "~/features/learning/edits.server";
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
    campaign: { slug: campaign.slug, name: campaign.name, status: campaign.status },
    asset,
    isKitAdopted: campaign.kitAssetId === asset.id,
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
  if (intent === "approve" || intent === "reject" || intent === "adopt") {
    if (!access.permissions.manage)
      return { ok: false as const, error: "承認できるのはリードとオーガナイザーです" };
    if (intent === "reject") {
      await moveAsset(env.DB, asset.id, ["needs_approval", "failed"], "rejected", access.user.id);
      return { ok: true as const, message: "却下しました" };
    }
    if (intent === "adopt") {
      const ok = await adoptKit(env.DB, access.campaign.id, asset.id, access.user.id);
      return ok
        ? { ok: true as const, message: "この案をキットにしました" }
        : { ok: false as const, error: "この案はもう選べません" };
    }
    const result = await approveAsset(env, access, asset);
    return result.ok
      ? { ok: true as const, message: result.message }
      : { ok: false as const, error: result.error };
  }
  if (intent === "revise") {
    const instructions = String(form.get("instructions") ?? "").trim();
    if (!instructions) return { ok: false as const, error: "直してほしいことを書いてください" };
    try {
      await enqueueAsset(env.DB, access.campaign.id, access.user.id, {
        templateId: asset.templateId,
        purpose: asset.purpose,
        forDraftId: asset.forDraftId ?? undefined,
        forScheduleItemId: asset.forScheduleItemId ?? undefined,
        forImageSlotId: asset.forImageSlotId ?? undefined,
        revisionOf: asset.id,
        instructions,
      });
    } catch (error) {
      if (error instanceof EnqueueError) return { ok: false as const, error: error.message };
      throw error;
    }
    return { ok: true as const, message: "秘書に直しを頼みました。できたら画像の一覧に出ます" };
  }
  if (intent === "edit") {
    let slots: Record<string, unknown> = asset.slots;
    let layoutVars: Record<string, unknown> = asset.layoutVars;
    let html: string | null = asset.html;
    if (asset.html !== null) {
      html = String(form.get("html") ?? "");
      if (!html.trim()) return { ok: false as const, error: "HTML が空です" };
    } else {
      try {
        slots = JSON.parse(String(form.get("slots") ?? "{}"));
        layoutVars = JSON.parse(String(form.get("layoutVars") ?? "{}"));
      } catch {
        return { ok: false as const, error: "JSON として読めません" };
      }
    }
    const created = await createAndRender(env, {
      campaignId: access.campaign.id,
      templateId: asset.templateId,
      purpose: asset.purpose,
      html,
      notes: asset.notes,
      slots,
      layoutVars,
      skinSource: String(asset.skin.source ?? "gdg-design"),
      author: "human",
      forDraftId: asset.forDraftId,
      forScheduleItemId: asset.forScheduleItemId,
      forImageSlotId: asset.forImageSlotId,
      derivedFromAssetId: asset.id,
    });
    await recordEdits(env.DB, {
      campaignId: access.campaign.id,
      assetId: created.id,
      fromVersion: asset.id,
      toVersion: created.id,
      kind: "asset_spec",
      before:
        asset.html !== null
          ? { html: asset.html }
          : { slots: asset.slots, layoutVars: asset.layoutVars },
      after: asset.html !== null ? { html } : { slots, layoutVars },
      beforeChecks: asset.checks,
      userId: access.user.id,
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
  const { campaign, asset, isKitAdopted, canApprove, thumbnailScale } = loaderData;
  const busy = useNavigation().state === "submitting";
  const [size, setSize] = useState<(typeof SIZES)[number]>("1x");
  const width =
    size === "1x" ? asset.width : size === "2x" ? asset.width * 2 : asset.width * thumbnailScale;
  const label = TEMPLATE_LABELS[asset.templateId] ?? asset.templateId;
  const title =
    asset.purpose === "kit"
      ? `顔の案: ${asset.notes.label ?? `#${asset.id}`}`
      : `${label} #${asset.id}`;
  return (
    <CampaignLayout campaign={campaign} title={title}>
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={asset.status === "approved" ? "success" : "warning"}>
          {isKitAdopted ? "キット" : ASSET_STATUS_LABELS[asset.status]}
        </Badge>
        {asset.html !== null ? <Badge tone="info">秘書のデザイン</Badge> : null}
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
                  alt={label}
                  style={{ width, maxWidth: "none" }}
                  className="border border-border"
                />
              ) : (
                <Text tone="muted">画像がありません。</Text>
              )}
            </div>
          </Stack>
        </Card>
        <Stack>
          <Card>
            <CheckResults results={asset.checks} />
          </Card>
          {asset.notes.rationaleMd || asset.notes.selfReviewMd || asset.notes.kit ? (
            <Card>
              <Stack>
                <Heading level={2} className="text-lg">
                  秘書の判断
                </Heading>
                {asset.notes.kit ? (
                  <Text>
                    <strong>{asset.notes.kit.feel}</strong>
                    <span className="block text-muted">{asset.notes.kit.why}</span>
                  </Text>
                ) : null}
                {asset.notes.rationaleMd ? (
                  <Text className="whitespace-pre-wrap">{asset.notes.rationaleMd}</Text>
                ) : null}
                {asset.notes.selfReviewMd ? (
                  <details>
                    <summary className="cursor-pointer text-sm text-muted">セルフレビュー</summary>
                    <Text className="whitespace-pre-wrap" tone="muted">
                      {asset.notes.selfReviewMd}
                    </Text>
                  </details>
                ) : null}
              </Stack>
            </Card>
          ) : null}
        </Stack>
      </div>
      {canApprove && asset.purpose === "kit" && !isKitAdopted && asset.status !== "rejected" ? (
        <Form method="post" className="flex gap-2">
          <Button type="submit" name="intent" value="adopt" loading={busy}>
            この案をキットにする
          </Button>
          <Button type="submit" name="intent" value="reject" variant="ghost" loading={busy}>
            却下
          </Button>
        </Form>
      ) : null}
      {asset.status === "needs_approval" && asset.purpose === "image" && canApprove ? (
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
              秘書に直してもらう
            </Heading>
            <FormField
              label="直してほしいこと"
              description="例: 題をもう少し大きく、写真を左に、色をもっと落ち着いた青に"
            >
              <Textarea name="instructions" rows={2} />
            </FormField>
            <div>
              <Button type="submit" name="intent" value="revise" variant="outline" loading={busy}>
                直しを頼む
              </Button>
            </div>
          </Stack>
        </Form>
      </Card>
      <Card>
        <Form method="post">
          <Stack>
            <Heading level={2} className="text-lg">
              自分で直して描画し直す
            </Heading>
            {asset.html !== null ? (
              <FormField label="HTML" description="script と外部 URL は描画時に消されます">
                <Textarea
                  name="html"
                  rows={14}
                  defaultValue={asset.html}
                  className="font-mono text-xs"
                />
              </FormField>
            ) : (
              <>
                <FormField label="スロット（JSON）">
                  <Textarea
                    name="slots"
                    rows={8}
                    defaultValue={JSON.stringify(asset.slots, null, 2)}
                  />
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
              </>
            )}
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
