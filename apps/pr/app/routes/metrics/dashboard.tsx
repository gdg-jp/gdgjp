import { Badge, Button, Card, EmptyState, Heading, Stack, Table, Text } from "@gdgjp/design-system";
import { Form, Link, useNavigation } from "react-router";
import { enqueueAnalyze } from "~/features/analyze/analyze.server";
import { MEDIUM_LABELS } from "~/features/budget/flight";
import { requireCampaignAccess } from "~/features/campaigns/access.server";
import { EnqueueError } from "~/features/jobs/enqueue.server";
import { LineChart } from "~/features/metrics/components/LineChart";
import { dashboard } from "~/features/metrics/dashboard.server";
import { CampaignLayout } from "~/layouts/CampaignLayout";
import type { Route } from "./+types/dashboard";

export function meta() {
  return [{ title: "数値 — GDG PR" }];
}

export async function loader({ request, context, params }: Route.LoaderArgs) {
  const env = context.cloudflare.env;
  const access = await requireCampaignAccess(env, request, params.slug);
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
    data: await dashboard(env, access),
  };
}

export async function action({ request, context, params }: Route.ActionArgs) {
  const env = context.cloudflare.env;
  const access = await requireCampaignAccess(env, request, params.slug);
  try {
    await enqueueAnalyze(env.DB, access.campaign.id, access.user.id);
  } catch (error) {
    if (error instanceof EnqueueError) return { message: error.message };
    throw error;
  }
  return { message: "分析のジョブを積みました。レポートは下書きに出ます" };
}

const yen = (n: number | null) => (n === null ? "—" : `${n.toLocaleString("ja-JP")} 円`);
const pct = (n: number | null) => (n === null ? "—" : `${Math.round(n * 1000) / 10}%`);

export default function Metrics({ loaderData, actionData }: Route.ComponentProps) {
  const { user, accountsUrl, campaign, data } = loaderData;
  const busy = useNavigation().state === "submitting";
  return (
    <CampaignLayout user={user} accountsUrl={accountsUrl} campaign={campaign} title="数値">
      <div className="flex flex-wrap items-center gap-2">
        <Link to={`/c/${campaign.slug}/metrics/import`} className="text-link text-sm">
          広告の CSV を取り込む
        </Link>
        <Link to={`/c/${campaign.slug}/budget`} className="text-link text-sm">
          広告フライト
        </Link>
        <Form method="post" className="ml-auto">
          <Button type="submit" variant="outline" size="sm" loading={busy}>
            分析する
          </Button>
        </Form>
      </div>
      {actionData?.message ? <Text tone="muted">{actionData.message}</Text> : null}
      <Card>
        <Stack>
          <Heading level={2} className="text-lg">
            申込の推移
          </Heading>
          {data.applications && data.status ? (
            <div className="flex flex-wrap gap-4" aria-label="申込の状況">
              <span className="text-2xl font-bold">{data.applications.applications} 件</span>
              <Badge tone={data.status.diff >= 0 ? "success" : "danger"}>
                目標曲線と {data.status.diff >= 0 ? "+" : ""}
                {data.status.diff}
              </Badge>
              <Text tone="muted">
                残り {data.status.daysLeft} 日・1 日あたり {data.status.perDayNeeded} 件必要・補欠{" "}
                {data.applications.waitlisted}・キャンセル {data.applications.canceled}・出席{" "}
                {data.applications.attended}
              </Text>
            </div>
          ) : (
            <EmptyState
              title="まだ数値がありません"
              description="告知中のキャンペーンは毎時 connpass から集めます。"
            />
          )}
          <LineChart series={data.series} goal={data.goalSeries} />
        </Stack>
      </Card>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <Stack>
            <Heading level={2} className="text-lg">
              チャネル別
            </Heading>
            <Table aria-label="チャネル別">
              <thead>
                <tr>
                  <th>チャネル</th>
                  <th>クリック</th>
                  <th>申込</th>
                  <th>申込率</th>
                </tr>
              </thead>
              <tbody>
                {data.channels.map((c) => (
                  <tr key={c.name}>
                    <td>{c.name}</td>
                    <td>{c.clicks}</td>
                    <td>{c.applications ?? "未取り込み"}</td>
                    <td>{pct(c.rate)}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </Stack>
        </Card>
        <Card>
          <Stack>
            <Heading level={2} className="text-lg">
              広告と予算
            </Heading>
            <Table aria-label="広告">
              <thead>
                <tr>
                  <th>媒体</th>
                  <th>費用</th>
                  <th>クリック</th>
                  <th>CPC</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>X</td>
                  <td>{yen(data.ads.x.spend)}</td>
                  <td>{data.ads.x.clicks}</td>
                  <td>{yen(data.ads.x.cpc)}</td>
                </tr>
                <tr>
                  <td>Instagram</td>
                  <td>{yen(data.ads.ig.spend)}</td>
                  <td>{data.ads.ig.clicks}</td>
                  <td>{yen(data.ads.ig.cpc)}</td>
                </tr>
              </tbody>
            </Table>
            <ul className="space-y-1 text-sm" aria-label="フライト">
              {data.flights.map((f) => (
                <li key={f.id}>
                  {MEDIUM_LABELS[f.medium]} {f.name}: 計画 {yen(f.plannedYen)} / 実績{" "}
                  {yen(f.actualYen)}
                </li>
              ))}
            </ul>
            {data.split.planned.share !== null ? (
              <Badge tone={data.split.planned.inRange ? "success" : "danger"}>
                計画の X 比率 {pct(data.split.planned.share)}（Playbook の範囲
                {data.split.planned.inRange ? "内" : "外"}）
              </Badge>
            ) : null}
          </Stack>
        </Card>
      </div>
      <Card>
        <Stack>
          <Heading level={2} className="text-lg">
            運用
          </Heading>
          <Text>
            レビュー待ち {data.operations.inReview}・承認待ち {data.operations.needsApproval}
            ・配信失敗 {data.operations.failed}・返事待ち {data.operations.waitingReplies}・期限切れ{" "}
            {data.operations.overdue}・リンク切れ {data.operations.brokenLinks}
          </Text>
          <ul className="space-y-1 text-sm" aria-label="人別">
            {data.perPerson.map((p) => (
              <li key={p.name}>
                {p.name}: 今週 {p.thisWeek} 件{p.overdue ? `・期限切れ ${p.overdue} 件` : ""}
              </li>
            ))}
          </ul>
        </Stack>
      </Card>
    </CampaignLayout>
  );
}
