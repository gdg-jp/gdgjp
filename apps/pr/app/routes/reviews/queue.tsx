import { Card, EmptyState, Text } from "@gdgjp/design-system";
import { requireCampaignAccess } from "~/features/campaigns/access.server";
import { DraftTable } from "~/features/drafts/components/DraftTable";
import { draftRows } from "~/features/drafts/list.server";
import { CampaignLayout } from "~/layouts/CampaignLayout";
import type { Route } from "./+types/queue";

export function meta() {
  return [{ title: "レビューと承認 — GDG PR" }];
}

/** /c/:slug/reviews (in_review) and /c/:slug/approvals (needs_approval) share this screen. */
export async function loader({ request, context, params }: Route.LoaderArgs) {
  const env = context.cloudflare.env;
  const access = await requireCampaignAccess(env, request, params.slug);
  const approvals = new URL(request.url).pathname.endsWith("/approvals");
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
    approvals,
    drafts: await draftRows(
      env.DB,
      campaign.id,
      access.members,
      approvals ? ["needs_approval"] : ["in_review", "drafting"],
    ),
  };
}

export default function Queue({ loaderData }: Route.ComponentProps) {
  const { user, accountsUrl, campaign, approvals, drafts } = loaderData;
  return (
    <CampaignLayout
      user={user}
      accountsUrl={accountsUrl}
      campaign={campaign}
      title={approvals ? "承認待ち" : "レビュー待ち"}
    >
      <Text tone="muted">
        {approvals
          ? "レビューを通った下書き。承認するのはリードか主催チャプターのオーガナイザーです。"
          : "runner や担当者が書いた下書き。レビュアーが確認して承認に回します。"}
      </Text>
      {drafts.length ? (
        <DraftTable slug={campaign.slug} drafts={drafts} />
      ) : (
        <Card>
          <EmptyState
            title="ありません"
            description={
              approvals ? "承認待ちの下書きはありません。" : "レビュー待ちの下書きはありません。"
            }
          />
        </Card>
      )}
    </CampaignLayout>
  );
}
