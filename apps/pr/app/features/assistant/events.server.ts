import { getCampaignById } from "~/features/campaigns/campaign.repository.server";
import { getDraftById } from "~/features/drafts/draft.repository.server";
import type { CompleteOutcome } from "~/features/jobs/complete.server";
import type { FixTarget, Job, JobType } from "~/features/jobs/shared";
import type { MessageAction } from "./message";
import { insertMessage } from "./message.repository.server";

export const JOB_LABELS: Record<JobType, string> = {
  plan: "計画",
  copy: "タイトルとコピー",
  post: "投稿の下書き",
  page: "connpass の下書き",
  asset: "画像",
  analyze: "週次の分析",
  review: "レビュー",
  retro: "振り返り",
  fix: "下書きの修正",
  assist: "返事",
};

const open = (label: string, path: string): MessageAction => ({
  type: "open_page",
  label,
  path,
  status: "proposed",
});

/** The assistant speaks on its own, once per key (a repeat is ignored). */
export async function postEvent(
  db: D1Database,
  campaignId: number,
  key: string,
  body: string,
  actions: MessageAction[] = [],
): Promise<boolean> {
  const id = await insertMessage(db, {
    campaignId,
    author: "assistant",
    body,
    actions,
    eventKey: key,
  });
  return id !== null;
}

/**
 * After a job finishes, tell the thread what is ready (or what failed). A result whose MUST
 * failures queued an automatic fix waits for the fix.
 */
export async function announceJob(env: Env, job: Job, outcome: CompleteOutcome): Promise<void> {
  if (job.type === "assist" && outcome.status !== "failed") return;
  const campaign = await getCampaignById(env.DB, job.campaignId);
  if (!campaign) return;
  const base = `/c/${campaign.slug}`;
  const key = `job:${job.id}`;
  const summary = outcome.summary as {
    planVersion?: number;
    mustFails?: number;
    draftIds?: number[];
    assetId?: number;
  };
  const fixQueued = job.type !== "fix" && (summary.mustFails ?? 0) > 0;
  if (outcome.status === "failed") {
    const what = JOB_LABELS[job.type];
    await postEvent(
      env.DB,
      campaign.id,
      key,
      job.type === "assist"
        ? "返事を書けませんでした。少し待ってから、もう一度送ってください。"
        : `${what}を作れませんでした（${(outcome.error ?? "").slice(0, 160)}）。もう一度頼むときは、ここに書いてください。`,
    );
    return;
  }
  const target = job.type === "fix" ? (job.payload as { target?: FixTarget }).target : null;
  if (job.type === "plan" || target?.table === "plans") {
    if (fixQueued || summary.planVersion === undefined) return;
    const fails = summary.mustFails ?? 0;
    await postEvent(
      env.DB,
      campaign.id,
      key,
      fails
        ? `計画（版 ${summary.planVersion}）ができました。Playbook の必須検査に通っていない点が ${fails} 件あるので、計画の画面で確かめてください。`
        : `計画（版 ${summary.planVersion}）ができました。Playbook の必須検査はすべて通っています。採用すると予定表に入ります。`,
      [
        open("計画を見る", `${base}/plan`),
        ...(fails
          ? []
          : [
              {
                type: "adopt_plan",
                label: "採用する",
                planVersion: summary.planVersion,
                status: "proposed",
              } satisfies MessageAction,
            ]),
      ],
    );
    return;
  }
  if (job.type === "analyze") {
    const id = summary.draftIds?.[0];
    await postEvent(
      env.DB,
      campaign.id,
      key,
      "今週の分析ができました。予算と予定の付け替えの提案があります。",
      id ? [open("分析を開く", `${base}/drafts/${id}`)] : [],
    );
    return;
  }
  if (job.type === "retro") {
    await postEvent(env.DB, campaign.id, key, "振り返りから Playbook への提案を作りました。", [
      open("提案を開く", "/playbook/proposals"),
    ]);
    return;
  }
  if (job.type === "asset" && summary.assetId) {
    if (fixQueued) return;
    await postEvent(env.DB, campaign.id, key, "画像ができました。確かめて承認してください。", [
      open("画像を開く", `${base}/assets/${summary.assetId}`),
    ]);
    return;
  }
  const ids = summary.draftIds ?? [];
  if (!ids.length || fixQueued) return;
  const drafts = (await Promise.all(ids.map((id) => getDraftById(env.DB, id)))).filter(
    (d) => d !== null,
  );
  if (!drafts.length) return;
  const titles = drafts
    .slice(0, 5)
    .map((d) => `「${d.title}」`)
    .join("、");
  await postEvent(
    env.DB,
    campaign.id,
    key,
    `下書きができました: ${titles}${drafts.length > 5 ? ` ほか ${drafts.length - 5} 件` : ""}。レビューをお願いします。`,
    drafts.length === 1
      ? [open("下書きを開く", `${base}/drafts/${drafts[0]?.id}`)]
      : [open("下書きを開く", `${base}/reviews`)],
  );
}
