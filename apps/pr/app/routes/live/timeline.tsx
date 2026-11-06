import {
  Alert,
  Badge,
  Button,
  Card,
  Checkbox,
  EmptyState,
  Stack,
  Text,
} from "@gdgjp/design-system";
import { Form, Link, useNavigation } from "react-router";
import { requireCampaignAccess } from "~/features/campaigns/access.server";
import { draftForItem } from "~/features/drafts/draft.repository.server";
import { generateLivePosts } from "~/features/live/generate.server";
import { jstDate, jstTime } from "~/features/schedule/calendar";
import { listItems } from "~/features/schedule/item.repository.server";
import { STATUS_LABELS } from "~/features/schedule/kinds";
import { CampaignLayout } from "~/layouts/CampaignLayout";
import type { Route } from "./+types/timeline";

export function meta() {
  return [{ title: "当日実況 — GDG PR" }];
}

export async function loader({ request, context, params }: Route.LoaderArgs) {
  const env = context.cloudflare.env;
  const access = await requireCampaignAccess(env, request, params.slug);
  const { campaign } = access;
  const items = (await listItems(env.DB, campaign.id)).filter((i) => i.kind === "live_post");
  const names = Object.fromEntries(access.members.map((m) => [m.userId, m.name]));
  return {
    user: { name: access.user.name, email: access.user.email, image: access.user.image },
    accountsUrl: env.ACCOUNTS_URL,
    campaign: {
      slug: campaign.slug,
      name: campaign.name,
      status: campaign.status,
      chapterSlug: campaign.chapterSlug,
    },
    posts: await Promise.all(
      items.map(async (i) => ({
        id: i.id,
        at: `${jstDate(i.dueAt)} ${jstTime(i.dueAt)}`,
        title: i.title,
        purpose: i.purpose,
        status: i.status,
        draftId: (await draftForItem(env.DB, i.id))?.id ?? null,
        photographer: i.assigneeUserId ? (names[i.assigneeUserId] ?? null) : null,
      })),
    ),
  };
}

export async function action({ request, context, params }: Route.ActionArgs) {
  const env = context.cloudflare.env;
  const access = await requireCampaignAccess(env, request, params.slug);
  const form = await request.formData();
  const result = await generateLivePosts(env, access, { cards: form.get("cards") === "on" });
  return result.ok
    ? { ok: true as const, message: result.message }
    : { ok: false as const, message: result.error };
}

export default function LiveTimeline({ loaderData, actionData }: Route.ComponentProps) {
  const { user, accountsUrl, campaign, posts } = loaderData;
  const busy = useNavigation().state === "submitting";
  const unassigned = posts.filter((p) => p.purpose === "photo" && !p.photographer).length;
  return (
    <CampaignLayout user={user} accountsUrl={accountsUrl} campaign={campaign} title="当日実況">
      {actionData?.message ? (
        <Alert
          tone={actionData.ok ? "success" : "danger"}
          title={actionData.ok ? "作りました" : "できませんでした"}
        >
          {actionData.message}
        </Alert>
      ) : null}
      <Card>
        <Form method="post">
          <Stack>
            <Text tone="muted">
              brief のタイムテーブルから、セッション開始の投稿と終了後の写真投稿を作ります（AI
              は使いません）。 登壇順が変わったら brief
              を直して作り直します。予約済みの投稿は変えません。
            </Text>
            <div className="flex flex-wrap items-center gap-3">
              <Checkbox id="cards" name="cards" />
              <label htmlFor="cards">セッションカードの画像も作る</label>
              <Button type="submit" loading={busy}>
                タイムテーブルから作る
              </Button>
            </div>
          </Stack>
        </Form>
      </Card>
      {unassigned ? (
        <Text tone="muted">
          撮影担当が決まっていない写真投稿が {unassigned}{" "}
          本あります（スケジュールで担当を付けます）。
        </Text>
      ) : null}
      {posts.length === 0 ? (
        <Card>
          <EmptyState title="まだありません" description="タイムテーブルから作ります。" />
        </Card>
      ) : (
        <Card>
          <ul className="space-y-1" aria-label="実況の投稿">
            {posts.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center gap-2 text-sm">
                <span className="w-32 font-mono text-xs text-muted">{p.at}</span>
                <Badge tone={p.purpose === "photo" ? "info" : "neutral"}>
                  {p.purpose === "photo" ? "写真" : "開始"}
                </Badge>
                {p.draftId ? (
                  <Link to={`/c/${campaign.slug}/drafts/${p.draftId}`} className="text-link">
                    {p.title}
                  </Link>
                ) : (
                  <span>{p.title}</span>
                )}
                <Badge tone="neutral">{STATUS_LABELS[p.status]}</Badge>
                {p.photographer ? <Text tone="muted">撮影 {p.photographer}</Text> : null}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </CampaignLayout>
  );
}
