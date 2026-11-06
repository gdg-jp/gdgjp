import { Badge, Card, EmptyState, Heading, PageHeader, Stack } from "@gdgjp/design-system";
import { Link } from "react-router";
import { requireUserWithChapter } from "~/features/auth/access.server";
import { jstDate, jstTime } from "~/features/schedule/calendar";
import { listItemsForUser } from "~/features/schedule/item.repository.server";
import { KIND_LABELS, STATUS_LABELS } from "~/features/schedule/kinds";
import { AppLayout } from "~/layouts/AppLayout";
import type { Route } from "./+types/me";

export function meta() {
  return [{ title: "自分のタスク — GDG PR" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const env = context.cloudflare.env;
  const { user } = await requireUserWithChapter(env, request);
  const items = await listItemsForUser(env.DB, user.id);
  const now = Date.now() / 1000;
  const view = (i: (typeof items)[number]) => ({
    id: i.id,
    kind: i.kind,
    title: i.title,
    status: i.status,
    when: `${jstDate(i.dueAt)} ${jstTime(i.dueAt)}`,
    campaignSlug: i.campaignSlug,
    campaignName: i.campaignName,
    blocked: i.blockedBy.length > 0,
  });
  return {
    user: { name: user.name, email: user.email, image: user.image },
    accountsUrl: env.ACCOUNTS_URL,
    groups: [
      {
        title: "期限切れ",
        items: items.filter((i) => i.dueAt < now && i.assigneeUserId === user.id).map(view),
      },
      {
        title: "レビュー待ち（自分がレビュアー）",
        items: items
          .filter((i) => i.status === "in_review" && i.reviewerUserId === user.id)
          .map(view),
      },
      {
        title: "担当",
        items: items.filter((i) => i.dueAt >= now && i.assigneeUserId === user.id).map(view),
      },
    ],
  };
}

export default function Me({ loaderData }: Route.ComponentProps) {
  const { user, accountsUrl, groups } = loaderData;
  const empty = groups.every((g) => g.items.length === 0);
  return (
    <AppLayout user={user} accountsUrl={accountsUrl}>
      <Stack className="[word-break:auto-phrase]">
        <PageHeader
          title="自分のタスク"
          description="自分が担当かレビュアーのアイテム（全キャンペーン）。"
        />
        {empty ? (
          <Card>
            <EmptyState
              title="タスクはありません"
              description="スケジュールで担当かレビュアーに入るとここに出ます。"
            />
          </Card>
        ) : (
          groups.map((group) =>
            group.items.length ? (
              <Card key={group.title}>
                <Stack>
                  <Heading level={2} className="text-lg">
                    {group.title}
                  </Heading>
                  <ul className="space-y-1 text-sm">
                    {group.items.map((i) => (
                      <li key={i.id} className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-muted">{i.when}</span>
                        <Badge tone="neutral">{KIND_LABELS[i.kind]}</Badge>
                        <Link to={`/c/${i.campaignSlug}/schedule`} className="text-link">
                          {i.title}
                        </Link>
                        <span className="text-muted">
                          {i.campaignName} · {STATUS_LABELS[i.status]}
                          {i.blocked ? " · 条件待ち" : ""}
                        </span>
                      </li>
                    ))}
                  </ul>
                </Stack>
              </Card>
            ) : null,
          )
        )}
      </Stack>
    </AppLayout>
  );
}
