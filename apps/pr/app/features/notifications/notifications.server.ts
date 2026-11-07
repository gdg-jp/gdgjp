import { JOB_LABELS } from "~/features/assistant/events.server";
import type { Message } from "~/features/assistant/message";
import { lastMessages } from "~/features/assistant/message.repository.server";
import { listSources } from "~/features/assistant/source.repository.server";
import { latestBrief } from "~/features/briefs/brief.repository.server";
import type { Campaign } from "~/features/campaigns/campaign";
import { listCampaignsForChapters } from "~/features/campaigns/campaign.repository.server";
import { listCampaignTargets } from "~/features/dispatch/target.repository.server";
import { listDrafts } from "~/features/drafts/draft.repository.server";
import { listJobs } from "~/features/jobs/job.repository.server";
import { listProposals } from "~/features/learning/proposal.repository.server";
import { listPlans } from "~/features/plans/plan.repository.server";
import { jstDate, jstTime } from "~/features/schedule/calendar";
import { listItems } from "~/features/schedule/item.repository.server";
import { KIND_LABELS, REQUEST_KINDS, STATUS_LABELS } from "~/features/schedule/kinds";
import { type Notice, collapse, urgencyOf } from "./notice";

export type Viewer = { userId: string; chapterIds: number[]; organizer: boolean };

const OPEN = ["planned", "drafting", "in_review", "needs_approval"];
const MAX_CAMPAIGNS = 40;
const SOON = 3 * 86_400;

/** What waits on people in one campaign, what the assistant proposes, today and what is running. */
export async function campaignNotices(
  env: Env,
  campaign: Campaign,
  viewer: Viewer,
  lastMessage?: Message,
  now = Math.floor(Date.now() / 1000),
): Promise<Notice[]> {
  const db = env.DB;
  const base = `/c/${campaign.slug}`;
  const ref = { slug: campaign.slug, name: campaign.name };
  const [items, drafts, plans, jobs, brief, targets, sources] = await Promise.all([
    listItems(db, campaign.id),
    listDrafts(db, campaign.id),
    listPlans(db, campaign.id),
    listJobs(db, { campaignId: campaign.id, limit: 40 }),
    latestBrief(db, campaign.id),
    listCampaignTargets(db, campaign.id),
    listSources(db, campaign.id),
  ]);
  const last = lastMessage ?? (await lastMessages(db, [campaign.id])).get(campaign.id);
  const itemById = new Map(items.map((i) => [i.id, i]));
  const draftByItem = new Map(drafts.map((d) => [d.scheduleItemId, d]));
  const out: Notice[] = [];
  const add = (n: Omit<Notice, "campaign" | "urgency"> & { urgency?: Notice["urgency"] }) =>
    out.push({ urgency: urgencyOf(n.at, now), ...n, campaign: ref });

  if (!brief && !sources.length)
    add({
      key: `${campaign.id}:start`,
      group: "waiting",
      urgency: 1,
      title: "イベントページや資料の URL を秘書に貼ってください",
      href: base,
      action: { kind: "link", label: "貼る", href: base },
    });
  if (last?.author === "assistant" && last.questions.length)
    add({
      key: `${campaign.id}:question:${last.id}`,
      group: "waiting",
      urgency: 1,
      title: `秘書から質問: ${last.questions[0]}`,
      detail: last.questions.length > 1 ? `ほか ${last.questions.length - 1} 件` : undefined,
      href: base,
      action: { kind: "link", label: "答える", href: base },
    });
  for (const d of drafts) {
    const at = d.scheduleItemId ? itemById.get(d.scheduleItemId)?.dueAt : null;
    if (d.status === "needs_approval")
      add({
        key: `draft:${d.id}`,
        group: "waiting",
        at,
        title: `承認待ち: 「${d.title}」`,
        detail: at ? `${jstDate(at)} ${jstTime(at)} の予定` : undefined,
        href: `${base}/drafts/${d.id}`,
        action: { kind: "link", label: "開いて承認", href: `${base}/drafts/${d.id}` },
      });
    else if (d.status === "in_review" && d.kind === "report")
      add({
        key: `draft:${d.id}`,
        group: "proposal",
        title: `${d.title}が出ました`,
        detail: d.title.startsWith("週次")
          ? "予算と予定の付け替えの提案があります"
          : "Playbook への提案があります",
        href: `${base}/drafts/${d.id}`,
        action: { kind: "link", label: "開く", href: `${base}/drafts/${d.id}` },
      });
    else if (d.status === "in_review" && (!d.reviewerUserId || d.reviewerUserId === viewer.userId))
      add({
        key: `draft:${d.id}`,
        group: "waiting",
        at,
        title: `レビュー待ち: 「${d.title}」`,
        detail: d.mustFails ? `必須検査の不合格 ${d.mustFails} 件` : undefined,
        href: `${base}/drafts/${d.id}`,
        action: { kind: "link", label: "レビュー", href: `${base}/drafts/${d.id}` },
      });
  }
  for (const t of targets) {
    const item = itemById.get(t.scheduleItemId);
    const draft = item ? draftByItem.get(item.id) : undefined;
    if (t.status !== "pending" || !item || !draft || draft.status !== "approved") continue;
    if (!viewer.chapterIds.includes(t.account.chapterId)) continue;
    add({
      key: `target:${t.id}`,
      group: "waiting",
      at: item.dueAt,
      title: `配信の承認: ${t.account.label} で「${item.title}」`,
      href: `${base}/drafts/${draft.id}`,
      action: { kind: "link", label: "開いて承認", href: `${base}/drafts/${draft.id}` },
    });
  }
  if (
    brief &&
    brief.brief.sessions.length > 0 &&
    !campaign.kitAssetId &&
    !jobs.some((j) => j.type === "asset" && ["queued", "leased"].includes(j.status))
  )
    add({
      key: `${campaign.id}:kit`,
      group: "proposal",
      urgency: 0,
      title: "イベントのデザインキット（色と顔）がまだありません",
      detail: "秘書に案を 2〜3 つ作らせて、1 つ選ぶと画像が揃います",
      href: `${base}/assets`,
      action: { kind: "link", label: "案を作る", href: `${base}/assets` },
    });
  const latestPlan = plans[0];
  if (latestPlan && latestPlan.status === "draft" && !plans.some((p) => p.status === "adopted"))
    add({
      key: `plan:${latestPlan.id}`,
      group: "proposal",
      title: `計画（版 ${latestPlan.version}）ができています。採用すると予定表に入ります`,
      href: `${base}/plan`,
      action: { kind: "link", label: "計画を見る", href: `${base}/plan` },
    });
  for (const item of items) {
    if (item.status === "done" || item.status === "skipped" || item.dueAt > now + SOON) continue;
    const post = (intent: string, label: string) =>
      ({
        kind: "post",
        label,
        action: `${base}/approvals`,
        fields: { intent, item: String(item.id) },
      }) as const;
    if (item.kind === "speaker_request")
      add({
        key: `item:${item.id}`,
        group: "waiting",
        at: item.dueAt,
        title: `登壇者への依頼を送る: ${item.title}`,
        detail: "文面はレビューと承認の画面にあります",
        href: `${base}/approvals`,
        action: post("mark-sent", "送った"),
      });
    else if (REQUEST_KINDS.includes(item.kind) && !item.requestStatus)
      add({
        key: `item:${item.id}`,
        group: "waiting",
        at: item.dueAt,
        title: `${KIND_LABELS[item.kind]}: ${item.title}`,
        href: `${base}/approvals`,
        action: post("mark-sent", "送った"),
      });
    else if (
      REQUEST_KINDS.includes(item.kind) &&
      item.requestStatus === "sent" &&
      item.requestFollowupAt &&
      item.requestFollowupAt < now
    )
      add({
        key: `item:${item.id}`,
        group: "waiting",
        urgency: 1,
        title: `返事がありません: ${item.title}`,
        href: `${base}/approvals`,
        action: post("replied", "返事があった"),
      });
  }
  const overdue = items.filter(
    (i) => i.derivedFromItemId === null && OPEN.includes(i.status) && i.dueAt < now,
  );
  if (overdue.length)
    add({
      key: `${campaign.id}:overdue`,
      group: "waiting",
      urgency: 2,
      title: `期限を過ぎた予定が ${overdue.length} 件あります`,
      detail: overdue
        .slice(0, 3)
        .map((i) => `「${i.title}」`)
        .join("、"),
      href: `${base}/schedule`,
      action: { kind: "link", label: "予定表を開く", href: `${base}/schedule` },
    });
  const failedTypes = new Set<string>();
  for (const job of jobs) {
    if (failedTypes.has(job.type)) continue;
    failedTypes.add(job.type); // only the newest job of each type counts
    if (job.status !== "failed" || (job.finishedAt ?? 0) < now - SOON) continue;
    add({
      key: `job:${job.id}`,
      group: "waiting",
      urgency: 1,
      title: `秘書が${JOB_LABELS[job.type]}を作れませんでした`,
      detail: job.error?.slice(0, 120) ?? undefined,
      href: base,
      action: { kind: "link", label: "開く", href: base },
    });
  }
  const today = jstDate(now);
  for (const item of items)
    if (
      jstDate(item.dueAt) === today &&
      item.derivedFromItemId === null &&
      item.status !== "skipped"
    )
      add({
        key: `today:${item.id}`,
        group: "today",
        urgency: 0,
        at: item.dueAt,
        title: `${jstTime(item.dueAt)} ${KIND_LABELS[item.kind]}「${item.title}」`,
        detail: STATUS_LABELS[item.status],
        href: `${base}/schedule`,
        action: null,
      });
  const running = jobs.filter((j) => j.status === "queued" || j.status === "leased");
  if (running.length)
    add({
      key: `${campaign.id}:running`,
      group: "running",
      urgency: 0,
      title: `${[...new Set(running.map((j) => JOB_LABELS[j.type]))].join("、")}を作っています`,
      href: base,
      action: null,
    });
  return collapse(
    out,
    (n) =>
      n.title.startsWith("レビュー待ち")
        ? "review"
        : n.title.startsWith("承認待ち")
          ? "approval"
          : n.title.startsWith("配信の承認")
            ? "target"
            : n.group === "today"
              ? "today"
              : null,
    (kind, list) =>
      kind === "today"
        ? {
            title: `今日の予定が ${list.length} 件あります`,
            href: `${base}/schedule`,
            action: null,
          }
        : {
            title: `${kind === "review" ? "レビュー待ち" : kind === "approval" ? "承認待ち" : "配信の承認待ち"}の下書きが ${list.length} 件あります`,
            href: `${base}/${kind === "review" ? "reviews" : "approvals"}`,
            action: {
              kind: "link",
              label: "まとめて開く",
              href: `${base}/${kind === "review" ? "reviews" : "approvals"}`,
            },
          },
    3,
  );
}

/** Every live campaign of the sidebar's chapter, plus the chapter's Playbook proposals. */
export async function chapterNotices(
  env: Env,
  viewer: Viewer & { chapterId: number },
): Promise<Notice[]> {
  // The events still being worked on, newest first; a chapter never has dozens live at once.
  const campaigns = (await listCampaignsForChapters(env.DB, [viewer.chapterId]))
    .filter((c) => c.status !== "closed")
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, MAX_CAMPAIGNS);
  const last = await lastMessages(
    env.DB,
    campaigns.map((c) => c.id),
  );
  const out = (
    await Promise.all(campaigns.map((c) => campaignNotices(env, c, viewer, last.get(c.id))))
  ).flat();
  if (viewer.organizer) {
    const proposals = await listProposals(env.DB, [viewer.chapterId], { status: "proposed" });
    if (proposals.length)
      out.push({
        key: "playbook",
        group: "proposal",
        urgency: 0,
        campaign: null,
        title: `Playbook への提案が ${proposals.length} 件あります`,
        detail: "振り返りや分析から出た、次のイベントに効く変更です",
        href: "/playbook/proposals",
        action: { kind: "link", label: "決める", href: "/playbook/proposals" },
      });
  }
  return out;
}
