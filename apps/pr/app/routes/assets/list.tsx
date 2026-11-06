import {
  Badge,
  Button,
  Card,
  EmptyState,
  FormField,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Stack,
  Text,
  Textarea,
} from "@gdgjp/design-system";
import { Form, Link, useNavigation } from "react-router";
import { ASSET_STATUS_LABELS } from "~/features/assets/asset";
import { listAssets } from "~/features/assets/asset.repository.server";
import { requireCampaignAccess } from "~/features/campaigns/access.server";
import { EnqueueError, enqueueAsset } from "~/features/jobs/enqueue.server";
import { imageTemplates } from "~/features/playbook/guides.server";
import { CampaignLayout } from "~/layouts/CampaignLayout";
import type { Route } from "./+types/list";

export function meta() {
  return [{ title: "画像 — GDG PR" }];
}

export async function loader({ request, context, params }: Route.LoaderArgs) {
  const env = context.cloudflare.env;
  const access = await requireCampaignAccess(env, request, params.slug);
  const { campaign } = access;
  const assets = await listAssets(env.DB, campaign.id);
  return {
    user: { name: access.user.name, email: access.user.email, image: access.user.image },
    accountsUrl: env.ACCOUNTS_URL,
    campaign: {
      slug: campaign.slug,
      name: campaign.name,
      status: campaign.status,
      chapterSlug: campaign.chapterSlug,
    },
    templates: Object.keys(imageTemplates.schemas).sort(),
    assets: assets.map((a) => ({
      id: a.id,
      templateId: a.templateId,
      status: a.status,
      author: a.author,
      mustFails: a.checks.filter((c) => c.strength === "MUST" && c.status === "fail").length,
      hasImage: !!a.r2Key,
    })),
  };
}

export async function action({ request, context, params }: Route.ActionArgs) {
  const env = context.cloudflare.env;
  const access = await requireCampaignAccess(env, request, params.slug);
  const form = await request.formData();
  const templateId = String(form.get("templateId") ?? "");
  if (!(templateId in imageTemplates.schemas))
    return { ok: false as const, message: "テンプレートを選んでください" };
  try {
    await enqueueAsset(env.DB, access.campaign.id, access.user.id, {
      templateId,
      instructions: String(form.get("instructions") ?? "").trim() || undefined,
    });
  } catch (error) {
    if (error instanceof EnqueueError) return { ok: false as const, message: error.message };
    throw error;
  }
  return {
    ok: true as const,
    message: "画像のジョブを積みました。runner が書き終えると描画されます",
  };
}

export default function Assets({ loaderData, actionData }: Route.ComponentProps) {
  const { user, accountsUrl, campaign, templates, assets } = loaderData;
  const busy = useNavigation().state === "submitting";
  return (
    <CampaignLayout user={user} accountsUrl={accountsUrl} campaign={campaign} title="画像">
      {actionData?.message ? <Text tone="muted">{actionData.message}</Text> : null}
      <Card>
        <Form method="post">
          <Stack>
            <div className="grid gap-3 md:grid-cols-[16rem_1fr_auto] md:items-end">
              <FormField label="テンプレート">
                <Select name="templateId" defaultValue="connpass-thumbnail">
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {templates.map((t) => (
                      <SelectItem key={t} value={t}>
                        {t}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormField>
              <FormField label="指示" description="任意">
                <Textarea name="instructions" rows={1} />
              </FormField>
              <Button type="submit" loading={busy}>
                画像を作る
              </Button>
            </div>
          </Stack>
        </Form>
      </Card>
      {assets.length === 0 ? (
        <Card>
          <EmptyState
            title="画像はまだありません"
            description="テンプレートを選んで runner に頼みます。"
          />
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {assets.map((a) => (
            <Card key={a.id}>
              <Stack>
                {a.hasImage ? (
                  <img
                    src={`/c/${campaign.slug}/assets/${a.id}/image`}
                    alt={a.templateId}
                    className="w-full border border-border"
                  />
                ) : null}
                <div className="flex flex-wrap items-center gap-2">
                  <Link to={`/c/${campaign.slug}/assets/${a.id}`} className="text-link">
                    {a.templateId} #{a.id}
                  </Link>
                  <Badge
                    tone={
                      a.status === "approved"
                        ? "success"
                        : a.status === "failed"
                          ? "danger"
                          : "warning"
                    }
                  >
                    {ASSET_STATUS_LABELS[a.status]}
                  </Badge>
                  {a.mustFails ? <Badge tone="danger">MUST ×{a.mustFails}</Badge> : null}
                </div>
              </Stack>
            </Card>
          ))}
        </div>
      )}
    </CampaignLayout>
  );
}
