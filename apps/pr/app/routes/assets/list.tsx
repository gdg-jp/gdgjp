import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  FormField,
  Heading,
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
import { ASSET_STATUS_LABELS, KIT_TEMPLATE, TEMPLATE_LABELS } from "~/features/assets/asset";
import {
  adoptKit,
  getAsset,
  kitAssets,
  listAssets,
} from "~/features/assets/asset.repository.server";
import { createAndRender } from "~/features/assets/create.server";
import { latestBrief } from "~/features/briefs/brief.repository.server";
import { requireCampaignAccess } from "~/features/campaigns/access.server";
import { EnqueueError, enqueueAsset } from "~/features/jobs/enqueue.server";
import { openJobs } from "~/features/jobs/job.repository.server";
import { imageTemplates } from "~/features/playbook/guides.server";
import { CampaignLayout } from "~/layouts/CampaignLayout";
import type { Route } from "./+types/list";

export function meta() {
  return [{ title: "画像 — GDG PR" }];
}

const mustFails = (checks: { strength: string; status: string }[]) =>
  checks.filter((c) => c.strength === "MUST" && c.status === "fail").length;

export async function loader({ request, context, params }: Route.LoaderArgs) {
  const env = context.cloudflare.env;
  const access = await requireCampaignAccess(env, request, params.slug);
  const { campaign } = access;
  const [assets, kit, brief, jobs] = await Promise.all([
    listAssets(env.DB, campaign.id),
    kitAssets(env.DB, campaign.id),
    latestBrief(env.DB, campaign.id),
    openJobs(env.DB, campaign.id, "asset"),
  ]);
  const known = new Set(Object.keys(imageTemplates.schemas));
  const templates = Object.keys(TEMPLATE_LABELS).filter(
    (id) => known.has(id) && id !== "live-session-16x9",
  );
  const summarize = (a: (typeof assets)[number]) => ({
    id: a.id,
    templateId: a.templateId,
    label: a.notes.label ?? null,
    status: a.status,
    author: a.author,
    mustFails: mustFails(a.checks),
    hasImage: !!a.r2Key,
    rationale: a.notes.rationaleMd ?? null,
    kit: a.notes.kit
      ? { feel: a.notes.kit.feel, why: a.notes.kit.why, palette: a.notes.kit.palette }
      : null,
  });
  return {
    campaign: { slug: campaign.slug, name: campaign.name, status: campaign.status },
    canManage: access.permissions.manage,
    hasBrief: !!brief,
    templates,
    sessions: (brief?.brief.sessions ?? []).map((s) => ({ id: s.id, title: s.title })),
    speakers: (brief?.brief.speakers ?? []).map((s) => ({ id: s.id, name: s.name })),
    kit: {
      adopted: kit.adopted ? summarize(kit.adopted) : null,
      directions: kit.directions.map(summarize),
      running: jobs.some((j) => (j.payload as { purpose?: string }).purpose === "kit"),
    },
    running: jobs.filter((j) => (j.payload as { purpose?: string }).purpose !== "kit").length,
    assets: assets.filter((a) => a.purpose === "image").map(summarize),
  };
}

export async function action({ request, context, params }: Route.ActionArgs) {
  const env = context.cloudflare.env;
  const access = await requireCampaignAccess(env, request, params.slug);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "create");
  const instructions = String(form.get("instructions") ?? "").trim() || undefined;
  try {
    if (intent === "kit") {
      await enqueueAsset(env.DB, access.campaign.id, access.user.id, {
        templateId: KIT_TEMPLATE,
        purpose: "kit",
        instructions,
      });
      return { ok: true as const, message: "キットと顔の案を頼みました。できたらここに並びます" };
    }
    if (intent === "adopt") {
      if (!access.permissions.manage)
        return { ok: false as const, message: "キットを決められるのはリードとオーガナイザーです" };
      const id = Number(form.get("assetId"));
      const direction = await getAsset(env.DB, access.campaign.id, id);
      const ok = direction ? await adoptKit(env.DB, access.campaign.id, id, access.user.id) : false;
      if (!ok || !direction) return { ok: false as const, message: "この案はもう選べません" };
      // The face itself, as an image a person can approve and send to connpass.
      if (direction.html)
        await createAndRender(env, {
          campaignId: access.campaign.id,
          templateId: KIT_TEMPLATE,
          purpose: "image",
          html: direction.html,
          notes: { rationaleMd: direction.notes.rationaleMd, kit: direction.notes.kit },
          skinSource: "kit",
          author: "generator",
          derivedFromAssetId: direction.id,
        });
      return {
        ok: true as const,
        message:
          "この案をキットにしました。これからの画像はこの色と形で作ります。サムネイルも画像に入れました",
      };
    }
    const templateId = String(form.get("templateId") ?? "");
    if (!(templateId in imageTemplates.schemas))
      return { ok: false as const, message: "画像の種類を選んでください" };
    const target = String(form.get("target") ?? "");
    await enqueueAsset(env.DB, access.campaign.id, access.user.id, {
      templateId,
      sessionId: target.startsWith("session:") ? target.slice("session:".length) : undefined,
      speakerId: target.startsWith("speaker:") ? target.slice("speaker:".length) : undefined,
      instructions,
    });
    return { ok: true as const, message: "画像を頼みました。描画できたらここに出ます" };
  } catch (error) {
    if (error instanceof EnqueueError) return { ok: false as const, message: error.message };
    throw error;
  }
}

function Swatches({ palette }: { palette: Record<string, string | string[]> }) {
  const colours = ["dominant", "ground", "panel", "ink", "emphasis"]
    .map((k) => [k, palette[k]] as const)
    .filter(
      (e): e is readonly [string, string] =>
        typeof e[1] === "string" && /^#[0-9a-f]{6}$/i.test(e[1]),
    );
  return (
    <span className="inline-flex items-center gap-1" aria-label="配色">
      {colours.map(([k, c]) => (
        <span
          key={k}
          className="inline-block size-5 rounded-full border border-border"
          style={{ background: c }}
          title={c}
        />
      ))}
    </span>
  );
}

export default function Assets({ loaderData, actionData }: Route.ComponentProps) {
  const { campaign, canManage, hasBrief, templates, sessions, speakers, kit, running, assets } =
    loaderData;
  const busy = useNavigation().state === "submitting";
  const base = `/c/${campaign.slug}`;
  return (
    <CampaignLayout campaign={campaign} title="画像">
      {actionData ? (
        <Alert tone={actionData.ok ? "success" : "danger"} title={actionData.message} />
      ) : null}
      {!hasBrief ? (
        <Alert tone="warning" title="先に brief が要ります">
          秘書にイベントページや資料を貼って、brief ができてから画像を作れます。
        </Alert>
      ) : null}

      <Card>
        <Stack>
          <Heading level={2} className="text-lg">
            デザインキット
          </Heading>
          {kit.adopted ? (
            <div className="grid gap-4 md:grid-cols-[20rem_1fr]">
              {kit.adopted.hasImage ? (
                <Link to={`${base}/assets/${kit.adopted.id}`}>
                  <img
                    src={`${base}/assets/${kit.adopted.id}/image`}
                    alt="このイベントの顔"
                    className="w-full border border-border"
                  />
                </Link>
              ) : null}
              <Stack>
                {kit.adopted.kit ? (
                  <>
                    <Text>
                      <strong>{kit.adopted.kit.feel}</strong>{" "}
                      <Swatches palette={kit.adopted.kit.palette} />
                    </Text>
                    <Text tone="muted">{kit.adopted.kit.why}</Text>
                  </>
                ) : null}
                <Text tone="muted">
                  これからの画像はこの色・ロックアップ・写真の型で作ります。変えたいときは作り直してください。
                </Text>
                <Form method="post" className="flex flex-wrap items-end gap-2">
                  <input type="hidden" name="intent" value="kit" />
                  <FormField label="直してほしいこと" description="任意">
                    <Textarea name="instructions" rows={1} disabled={!hasBrief} />
                  </FormField>
                  <Button
                    type="submit"
                    variant="outline"
                    loading={busy}
                    disabled={!hasBrief || kit.running}
                  >
                    {kit.running ? "作っています…" : "キットを作り直す"}
                  </Button>
                </Form>
              </Stack>
            </div>
          ) : kit.directions.length ? (
            <Stack>
              <Text tone="muted">
                顔（connpass のサムネイル）の案です。1
                つ選ぶと、それがこのイベントのキットになります。
              </Text>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {kit.directions.map((d) => (
                  <Card key={d.id}>
                    <Stack>
                      {d.hasImage ? (
                        <Link to={`${base}/assets/${d.id}`}>
                          <img
                            src={`${base}/assets/${d.id}/image`}
                            alt={d.label ?? `案 ${d.id}`}
                            className="w-full border border-border"
                          />
                        </Link>
                      ) : (
                        <Text tone="muted">描画できませんでした</Text>
                      )}
                      <div className="flex flex-wrap items-center gap-2">
                        <strong>{d.label ?? `案 ${d.id}`}</strong>
                        {d.kit ? <Swatches palette={d.kit.palette} /> : null}
                        {d.mustFails ? <Badge tone="danger">MUST ×{d.mustFails}</Badge> : null}
                      </div>
                      {d.rationale ? <Text tone="muted">{d.rationale}</Text> : null}
                      {canManage ? (
                        <Form method="post">
                          <input type="hidden" name="intent" value="adopt" />
                          <input type="hidden" name="assetId" value={d.id} />
                          <Button type="submit" size="sm" loading={busy}>
                            これにする
                          </Button>
                        </Form>
                      ) : null}
                    </Stack>
                  </Card>
                ))}
              </div>
              <Form method="post" className="flex flex-wrap items-end gap-2">
                <input type="hidden" name="intent" value="kit" />
                <FormField label="どれも違うとき: こうしてほしい" description="任意">
                  <Textarea name="instructions" rows={1} />
                </FormField>
                <Button type="submit" variant="outline" loading={busy} disabled={kit.running}>
                  {kit.running ? "作っています…" : "別の案を頼む"}
                </Button>
              </Form>
            </Stack>
          ) : (
            <Form method="post">
              <input type="hidden" name="intent" value="kit" />
              <Stack>
                <Text tone="muted">
                  最初にキット（色・モチーフ・書体・ロックアップ）と顔の案を 2〜3 つ作ります。
                  イベントの場所や趣旨から秘書が決め、理由も書きます。
                </Text>
                <FormField
                  label="希望があれば"
                  description="例: 学生向けに明るく、公式のブランドガイドに沿って、去年と違う色に"
                >
                  <Textarea name="instructions" rows={2} disabled={!hasBrief} />
                </FormField>
                <div>
                  <Button type="submit" loading={busy} disabled={!hasBrief || kit.running}>
                    {kit.running ? "作っています…" : "キットと顔の案を作る"}
                  </Button>
                </div>
              </Stack>
            </Form>
          )}
        </Stack>
      </Card>

      <Card>
        <Form method="post">
          <input type="hidden" name="intent" value="create" />
          <Stack>
            <Heading level={2} className="text-lg">
              画像を作る
            </Heading>
            <div className="grid gap-3 md:grid-cols-[18rem_16rem_1fr_auto] md:items-end">
              <FormField label="種類">
                <Select name="templateId" defaultValue={templates[0]}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {templates.map((t) => (
                      <SelectItem key={t} value={t}>
                        {TEMPLATE_LABELS[t] ?? t}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormField>
              <FormField label="対象" description="セッションや登壇者の紹介なら">
                <Select name="target" defaultValue="none">
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">イベント全体</SelectItem>
                    {sessions.map((s) => (
                      <SelectItem key={s.id} value={`session:${s.id}`}>
                        {s.title}
                      </SelectItem>
                    ))}
                    {speakers.map((s) => (
                      <SelectItem key={s.id} value={`speaker:${s.id}`}>
                        {s.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormField>
              <FormField label="指示" description="任意">
                <Textarea name="instructions" rows={1} />
              </FormField>
              <Button type="submit" loading={busy} disabled={!hasBrief}>
                画像を作る
              </Button>
            </div>
            {running ? <Text tone="muted">作っている画像が {running} 件あります。</Text> : null}
            {!kit.adopted ? (
              <Text tone="muted">
                キットが無い間は、画像ごとに秘書が色と形を決めます。キットを決めると全部が揃います。
              </Text>
            ) : null}
          </Stack>
        </Form>
      </Card>

      {assets.length === 0 ? (
        <Card>
          <EmptyState title="画像はまだありません" description="種類を選んで秘書に頼みます。" />
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {assets.map((a) => (
            <Card key={a.id}>
              <Stack>
                {a.hasImage ? (
                  <img
                    src={`${base}/assets/${a.id}/image`}
                    alt={TEMPLATE_LABELS[a.templateId] ?? a.templateId}
                    className="w-full border border-border"
                  />
                ) : null}
                <div className="flex flex-wrap items-center gap-2">
                  <Link to={`${base}/assets/${a.id}`} className="text-link">
                    {TEMPLATE_LABELS[a.templateId] ?? a.templateId} #{a.id}
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
