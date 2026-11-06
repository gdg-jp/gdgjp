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
import { Form, Link, useNavigation } from "react-router";
import { requireCampaignAccess } from "~/features/campaigns/access.server";
import { DeliveryCard } from "~/features/dispatch/components/DeliveryCard";
import { deliveryView } from "~/features/dispatch/delivery.server";
import { CheckResults } from "~/features/drafts/components/CheckResults";
import { CopyCandidates } from "~/features/drafts/components/CopyCandidates";
import { XPostPreview } from "~/features/drafts/components/XPostPreview";
import { draftAction } from "~/features/drafts/detail.server";
import { DRAFT_KIND_LABELS } from "~/features/drafts/draft-kinds";
import { getDraft, listReviews, listVersions } from "~/features/drafts/draft.repository.server";
import { actorFor } from "~/features/drafts/review.server";
import { DRAFT_STATUS_LABELS } from "~/features/drafts/state-machine";
import { ListingCard } from "~/features/listings/components/ListingCard";
import {
  type ListingContent,
  PLATFORM_LABELS,
  listingAsText,
} from "~/features/listings/from-brief";
import { ConnpassPreview } from "~/features/pages/components/ConnpassPreview";
import { jstDate, jstTime } from "~/features/schedule/calendar";
import { CampaignLayout } from "~/layouts/CampaignLayout";
import type { Route } from "./+types/detail";

export function meta() {
  return [{ title: "下書き — GDG PR" }];
}

export async function loader({ request, context, params }: Route.LoaderArgs) {
  const env = context.cloudflare.env;
  const access = await requireCampaignAccess(env, request, params.slug);
  const draft = await getDraft(env.DB, access.campaign.id, Number(params.id));
  if (!draft) throw new Response(null, { status: 404 });
  const [versions, reviews] = await Promise.all([
    listVersions(env.DB, draft.id),
    listReviews(env.DB, draft.id),
  ]);
  const wanted = Number(new URL(request.url).searchParams.get("v")) || draft.currentVersion;
  const version = versions.find((v) => v.version === wanted) ?? versions[0] ?? null;
  const names = Object.fromEntries(access.members.map((m) => [m.userId, m.name]));
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
    draft,
    version,
    versions: versions.map((v) => ({
      version: v.version,
      author: v.author,
      who: v.userId ? (names[v.userId] ?? "?") : "runner",
    })),
    reviews: reviews.map((r) => ({
      ...r,
      who: names[r.userId] ?? r.userId,
      at: `${jstDate(r.createdAt)} ${jstTime(r.createdAt)}`,
    })),
    actor: actorFor(access, draft),
    delivery: await deliveryView(env, access, draft),
    people: {
      assignee: draft.assigneeUserId ? names[draft.assigneeUserId] : null,
      reviewer: draft.reviewerUserId ? names[draft.reviewerUserId] : null,
    },
  };
}

export async function action({ request, context, params }: Route.ActionArgs) {
  const env = context.cloudflare.env;
  const access = await requireCampaignAccess(env, request, params.slug);
  return draftAction(env, access, Number(params.id), await request.formData());
}

type Content = {
  posts?: { text?: string }[];
  candidates?: unknown[];
  html?: string;
  renderWarnings?: string[];
  imageSlots?: { id: string; purpose: string; text: string }[];
  sections?: { id: string; slots: { imageUrl?: string | null } }[];
  skin?: unknown;
};

/** The editable part of a version: a connpass page's HTML and skin are the Worker's. */
const editable = (content: Content | null) => {
  if (!content?.html) return content;
  const { html: _h, skin: _s, renderWarnings: _w, ...slots } = content;
  return slots;
};

export default function DraftDetail({ loaderData, actionData }: Route.ComponentProps) {
  const {
    user,
    accountsUrl,
    campaign,
    draft,
    version,
    versions,
    reviews,
    actor,
    people,
    delivery,
  } = loaderData;
  const navigation = useNavigation();
  const busy = navigation.state === "submitting";
  const content = (version?.content ?? null) as Content | null;
  const isPost = draft.kind === "x_post" || draft.kind === "ig_post";
  const canAct = draft.status === "in_review" || draft.status === "needs_approval";
  return (
    <CampaignLayout user={user} accountsUrl={accountsUrl} campaign={campaign} title={draft.title}>
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="neutral">{DRAFT_KIND_LABELS[draft.kind]}</Badge>
        <Badge tone={draft.status === "approved" ? "success" : "warning"}>
          {DRAFT_STATUS_LABELS[draft.status]}
        </Badge>
        <Text tone="muted">
          担当 {people.assignee ?? "なし"} · レビュアー{" "}
          {people.reviewer ?? "未指定（レビュアー役のメンバー）"}
        </Text>
        <Link to={`/c/${campaign.slug}/drafts`} className="ml-auto text-sm text-link">
          下書き一覧へ
        </Link>
      </div>
      {actionData?.errors?.length ? (
        <Alert tone="danger" title="できませんでした">
          {actionData.errors.slice(0, 8).join(" / ")}
        </Alert>
      ) : null}
      {actionData?.ok && actionData.message ? (
        <Alert tone="success" title="完了">
          {actionData.message}
        </Alert>
      ) : null}
      {draft.status === "generating" ? (
        <Alert tone="info" title="runner が書いています">
          検査で MUST が落ちた版は、1 回だけ自動で直しています。
        </Alert>
      ) : null}
      <nav aria-label="版" className="flex flex-wrap gap-2">
        {versions.map((v) => (
          <Link
            key={v.version}
            to={`?v=${v.version}`}
            className={`rounded-md border border-border px-2 py-1 text-sm ${version?.version === v.version ? "bg-selected" : ""}`}
          >
            版 {v.version}（{v.author === "agent" ? "runner" : v.who}）
          </Link>
        ))}
      </nav>
      {version ? (
        <div className="grid gap-4 lg:grid-cols-[1fr_24rem]">
          <Card>
            <Stack>
              <Heading level={2} className="text-lg">
                本文（版 {version.version}）
              </Heading>
              {isPost && content?.posts
                ? content.posts.map((p, i) => (
                    <XPostPreview key={`${i}-${p.text?.slice(0, 8)}`} post={p} />
                  ))
                : null}
              {draft.kind === "copy" && content?.candidates ? (
                <CopyCandidates candidates={content.candidates as never[]} />
              ) : null}
              {!isPost && draft.kind !== "copy" && draft.kind !== "listing" && !content?.html ? (
                <pre className="overflow-x-auto whitespace-pre-wrap text-xs">
                  {JSON.stringify(content, null, 2)}
                </pre>
              ) : null}
            </Stack>
          </Card>
          <Card>
            <CheckResults results={version.checkResults} />
          </Card>
        </div>
      ) : (
        <Text tone="muted">まだ版がありません。</Text>
      )}
      {canAct && (actor.canReview || actor.canApprove) ? (
        <Card>
          <Form method="post">
            <Stack>
              <Heading level={2} className="text-lg">
                {draft.status === "in_review" ? "レビュー" : "承認"}
              </Heading>
              <FormField label="コメント" description="差し戻すときは何を直すかを書く">
                <Textarea name="comment" rows={2} />
              </FormField>
              <div className="flex flex-wrap gap-2">
                {draft.status === "in_review" && actor.canReview ? (
                  <Button type="submit" name="intent" value="review_ok" loading={busy}>
                    レビュー OK（承認に回す）
                  </Button>
                ) : null}
                {actor.canApprove && (draft.status === "needs_approval" || actor.canReview) ? (
                  <Button
                    type="submit"
                    name="intent"
                    value="approve"
                    variant={draft.status === "needs_approval" ? "primary" : "outline"}
                    loading={busy}
                  >
                    承認
                  </Button>
                ) : null}
                <Button
                  type="submit"
                  name="intent"
                  value="request_changes"
                  variant="outline"
                  loading={busy}
                >
                  差し戻す
                </Button>
                {actor.canApprove ? (
                  <Button type="submit" name="intent" value="reject" variant="ghost" loading={busy}>
                    却下
                  </Button>
                ) : null}
              </div>
            </Stack>
          </Form>
        </Card>
      ) : null}
      {content?.html ? (
        <ConnpassPreview
          html={content.html}
          warnings={content.renderWarnings ?? []}
          imageSlots={content.imageSlots ?? []}
          imageUrls={Object.fromEntries(
            (content.sections ?? []).map((s) => [s.id, s.slots.imageUrl ?? null]),
          )}
          busy={busy}
        />
      ) : null}
      {draft.kind === "listing" && content ? (
        <ListingCard
          platform={PLATFORM_LABELS[(content as unknown as ListingContent).platform]}
          fields={listingAsText(content as unknown as ListingContent)}
          approved={draft.status === "approved"}
          busy={busy}
        />
      ) : null}
      {draft.kind === "connpass_page" && draft.status === "approved" ? (
        <Form method="post">
          <Button
            type="submit"
            name="intent"
            value="connpass-retry"
            variant="outline"
            loading={busy}
          >
            connpass にもう一度反映する
          </Button>
        </Form>
      ) : null}
      {delivery ? <DeliveryCard view={delivery} busy={busy} /> : null}
      {version && draft.status !== "generating" ? (
        <Card>
          <Form method="post" key={version.version}>
            <Stack>
              <Heading level={2} className="text-lg">
                直す
              </Heading>
              {isPost && content?.posts?.[0] ? (
                <FormField
                  label="投稿の本文"
                  description="折りたたみ位置は保存時に自動で決まります。リンクは {{shortlink}}"
                >
                  <Textarea name="text" rows={10} defaultValue={content.posts[0].text ?? ""} />
                </FormField>
              ) : (
                <FormField label="JSON" description="出力スキーマの形のまま直す">
                  <Textarea
                    name="json"
                    rows={12}
                    defaultValue={JSON.stringify(editable(content), null, 2)}
                  />
                </FormField>
              )}
              <div className="flex flex-wrap gap-2">
                <Button
                  type="submit"
                  name="intent"
                  value={isPost && content?.posts?.[0] ? "edit-text" : "edit-json"}
                  loading={busy}
                >
                  新しい版として保存
                </Button>
              </div>
            </Stack>
          </Form>
        </Card>
      ) : null}
      <Card>
        <Form method="post">
          <Stack>
            <Heading level={2} className="text-lg">
              runner に作り直してもらう
            </Heading>
            <FormField label="指示">
              <Textarea name="instructions" rows={2} />
            </FormField>
            <div>
              <Button
                type="submit"
                name="intent"
                value="regenerate"
                variant="outline"
                loading={busy}
              >
                作り直す
              </Button>
            </div>
          </Stack>
        </Form>
      </Card>
      {reviews.length ? (
        <Card>
          <Stack>
            <Heading level={2} className="text-lg">
              レビューの記録
            </Heading>
            <ul className="space-y-1 text-sm">
              {reviews.map((r) => (
                <li key={r.id}>
                  <span className="font-mono text-xs text-muted">{r.at}</span> {r.who}（版{" "}
                  {r.version}、{r.stage === "review" ? "レビュー" : "承認"}）:{" "}
                  {{ approve: "OK", request_changes: "差し戻し", reject: "却下" }[r.decision]}
                  {r.comment ? ` — ${r.comment}` : ""}
                </li>
              ))}
            </ul>
          </Stack>
        </Card>
      ) : null}
    </CampaignLayout>
  );
}
