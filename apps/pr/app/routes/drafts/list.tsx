import { Card, EmptyState } from "@gdgjp/design-system";
import { requireCampaignAccess } from "~/features/campaigns/access.server";
import { DraftTable } from "~/features/drafts/components/DraftTable";
import { draftRows } from "~/features/drafts/list.server";
import { CampaignLayout } from "~/layouts/CampaignLayout";
import type { Route } from "./+types/list";

export function meta() {
  return [{ title: "下書き — GDG PR" }];
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
    drafts: await draftRows(env.DB, campaign.id, access.members),
  };
}

export default function Drafts({ loaderData }: Route.ComponentProps) {
  const { user, accountsUrl, campaign, drafts } = loaderData;
  return (
    <CampaignLayout user={user} accountsUrl={accountsUrl} campaign={campaign} title="下書き">
      {drafts.length ? (
        <DraftTable slug={campaign.slug} drafts={drafts} />
      ) : (
        <Card>
          <EmptyState
            title="下書きはまだありません"
            description="計画の「コピーを作る」や、スケジュールの「下書きを作る」で runner が書きます。"
          />
        </Card>
      )}
    </CampaignLayout>
  );
}
