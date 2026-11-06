import { Alert, Badge, Button, Card, Heading, Stack, Text } from "@gdgjp/design-system";
import { Link } from "react-router";
import { latestBrief } from "~/features/briefs/brief.repository.server";
import { requireCampaignAccess } from "~/features/campaigns/access.server";
import { PLAYBOOK_VERSION, provisionalConstants } from "~/features/playbook/playbook";
import { jstDate, jstTime } from "~/features/schedule/calendar";
import { listItems } from "~/features/schedule/item.repository.server";
import { KIND_LABELS, STATUS_LABELS } from "~/features/schedule/kinds";
import { CampaignLayout } from "~/layouts/CampaignLayout";
import type { Route } from "./+types/overview";

export function meta() {
  return [{ title: "概要 — GDG PR" }];
}

export async function loader({ request, context, params }: Route.LoaderArgs) {
  const env = context.cloudflare.env;
  const access = await requireCampaignAccess(env, request, params.slug);
  const [items, stored] = await Promise.all([
    listItems(env.DB, access.campaign.id),
    latestBrief(env.DB, access.campaign.id),
  ]);
  const now = Date.now() / 1000;
  const counts: Record<string, number> = {};
  for (const item of items) counts[item.status] = (counts[item.status] ?? 0) + 1;
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
    brief: stored
      ? {
          version: stored.version,
          name: stored.brief.event.name,
          startAt: stored.brief.event.startAt,
          venue: stored.brief.event.venue,
          metaThemes: stored.brief.metaThemes,
          sessions: stored.brief.sessions.length,
          confirmed: stored.brief.sessions.filter((s) => s.status !== "tba").length,
          goal: stored.brief.goals.applications,
        }
      : null,
    counts,
    upcoming: items
      .filter(
        (i) =>
          i.dueAt >= now &&
          i.dueAt < now + 14 * 86400 &&
          i.status !== "done" &&
          i.status !== "skipped",
      )
      .slice(0, 12)
      .map((i) => ({
        id: i.id,
        kind: i.kind,
        title: i.title,
        date: jstDate(i.dueAt),
        time: jstTime(i.dueAt),
        status: i.status,
      })),
    chapters: access.campaignChapters,
    playbookVersion: PLAYBOOK_VERSION,
    campaignPlaybook: campaign.playbookVersion,
    provisional: provisionalConstants(),
  };
}

export default function Overview({ loaderData }: Route.ComponentProps) {
  const {
    user,
    accountsUrl,
    campaign,
    brief,
    counts,
    upcoming,
    chapters,
    playbookVersion,
    campaignPlaybook,
    provisional,
  } = loaderData;
  return (
    <CampaignLayout user={user} accountsUrl={accountsUrl} campaign={campaign} title="概要">
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <Stack>
            <Heading level={2} className="text-lg">
              brief
            </Heading>
            {brief ? (
              <dl className="grid grid-cols-[8rem_1fr] gap-y-1 text-sm">
                <dt className="text-muted">版</dt>
                <dd>{brief.version}</dd>
                <dt className="text-muted">日時</dt>
                <dd>{brief.startAt || "未定"}</dd>
                <dt className="text-muted">会場</dt>
                <dd>{brief.venue || "未定"}</dd>
                <dt className="text-muted">メタテーマ</dt>
                <dd>{brief.metaThemes.join(" / ") || "未定"}</dd>
                <dt className="text-muted">セッション</dt>
                <dd>
                  {brief.confirmed} / {brief.sessions} 確定
                </dd>
                <dt className="text-muted">申込目標</dt>
                <dd>{brief.goal}</dd>
              </dl>
            ) : (
              <Text tone="muted">まだありません。</Text>
            )}
            <div>
              <Button asChild variant="outline" size="sm">
                <Link to={`/c/${campaign.slug}/brief`}>brief を開く</Link>
              </Button>
            </div>
          </Stack>
        </Card>
        <Card>
          <Stack>
            <Heading level={2} className="text-lg">
              アイテムの状態
            </Heading>
            <div className="flex flex-wrap gap-2">
              {Object.entries(counts).length === 0 ? (
                <Text tone="muted">アイテムがありません。</Text>
              ) : null}
              {Object.entries(counts).map(([status, n]) => (
                <Badge key={status} tone="neutral">
                  {STATUS_LABELS[status as keyof typeof STATUS_LABELS] ?? status} {n}
                </Badge>
              ))}
            </div>
            <Heading level={3} className="text-sm">
              主催・共催
            </Heading>
            <Text>
              {chapters
                .map((c) => `${c.chapterSlug}（${c.role === "host" ? "主催" : "共催"}）`)
                .join("、")}
            </Text>
          </Stack>
        </Card>
      </div>
      <Card>
        <Stack>
          <Heading level={2} className="text-lg">
            これから 14 日
          </Heading>
          {upcoming.length === 0 ? (
            <Text tone="muted">予定はありません。</Text>
          ) : (
            <ul className="space-y-1 text-sm">
              {upcoming.map((i) => (
                <li key={i.id} className="flex flex-wrap gap-2">
                  <span className="font-mono text-muted">
                    {i.date} {i.time}
                  </span>
                  <Badge tone="neutral">{KIND_LABELS[i.kind]}</Badge>
                  <span>{i.title}</span>
                  <span className="text-muted">{STATUS_LABELS[i.status]}</span>
                </li>
              ))}
            </ul>
          )}
        </Stack>
      </Card>
      <Alert tone="warning" title="Playbook の仮値">
        次の値はまだ実測ではありません: {provisional.join("、")}。Playbook {playbookVersion}（作成時{" "}
        {campaignPlaybook}）。
      </Alert>
    </CampaignLayout>
  );
}
