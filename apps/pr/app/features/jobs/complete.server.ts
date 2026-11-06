import {
  type CheckReport,
  mustFailures,
  validateSchema,
} from "@skills/pr-playbook/scripts/checks/index.mjs";
import type { Brief } from "~/features/briefs/brief";
import { briefVersion, latestBrief } from "~/features/briefs/brief.repository.server";
import type { DraftKind } from "~/features/drafts/draft-kinds";
import {
  appendVersion,
  createDraft,
  draftForItem,
  getDraftById,
} from "~/features/drafts/draft.repository.server";
import { itemStatusFor } from "~/features/drafts/state-machine";
import type { PlanBody } from "~/features/plans/plan";
import { insertPlan } from "~/features/plans/plan.repository.server";
import { outputSchemas } from "~/features/playbook/guides.server";
import {
  type DraftKind as CheckKind,
  PLAYBOOK_VERSION,
  runChecks,
} from "~/features/playbook/playbook";
import { listItems } from "~/features/schedule/item.repository.server";
import { skillFor } from "./bundle.server";
import { importAsset } from "./import-asset.server";
import { importPage } from "./import-page.server";
import { insertJob } from "./job.repository.server";
import type { FixTarget, Job, RunnerResult } from "./shared";

type Yomiyasu = { status: "pass" | "fail" | "unevaluated"; detail?: string } | null;

export type CompleteOutcome = {
  status: "succeeded" | "failed" | "needs_review";
  summary: Record<string, unknown>;
  error?: string;
};

/**
 * Import a runner result. The runner is not trusted: the output is validated against the
 * Skill's schema here, then every saved version is checked against the Playbook. A MUST
 * failure gets one automatic fix job; a fix's own result goes to review as is.
 */
export async function importResult(
  db: D1Database,
  job: Job,
  result: RunnerResult,
  env?: Env,
): Promise<CompleteOutcome> {
  if (result.status === "failed")
    return { status: "failed", summary: {}, error: result.error ?? "runner failed" };
  const output = result.result?.output;
  const yomiyasu = (result.result?.checks?.yomiyasu ?? null) as Yomiyasu;
  const { skill, kind } = skillFor(job);
  const schema = outputSchemas[skill];
  const errors = schema ? validateSchema(schema, output) : [`no schema for ${skill}`];
  if (errors.length)
    return {
      status: "failed",
      summary: { schemaErrors: errors.slice(0, 20) },
      error: `output does not match ${skill}: ${errors[0]}`,
    };
  const payload = job.payload as Record<string, unknown>;
  const brief = await briefOf(
    db,
    job.campaignId,
    typeof payload.briefVersion === "number" ? payload.briefVersion : null,
  );

  if (
    job.type === "plan" ||
    (job.type === "fix" && (payload.target as FixTarget).table === "plans")
  ) {
    const report = runChecks({ kind: "plan", draft: output, brief, yomiyasu });
    const plan = await insertPlan(db, {
      campaignId: job.campaignId,
      body: output as PlanBody,
      jobId: job.id,
      author: "agent",
      playbookVersion: PLAYBOOK_VERSION,
      checkResults: report.results,
    });
    if (job.type !== "fix")
      await maybeFix(
        db,
        job,
        { table: "plans", id: plan.id, version: plan.version },
        "plan",
        report,
      );
    return {
      status: "succeeded",
      summary: { planVersion: plan.version, mustFails: mustFailures(report).length },
    };
  }

  if (job.type === "copy" || (job.type === "fix" && kind === "copy")) {
    const draftId =
      job.type === "fix"
        ? (payload.target as FixTarget).id
        : ((payload.draftId as number | null) ??
          (await createDraft(db, {
            campaignId: job.campaignId,
            kind: "copy",
            title: "タイトルとメインコピー",
            scheduleItemId: null,
          })));
    const saved = await saveVersion(db, job, draftId, "copy", output, brief, yomiyasu);
    return { status: "succeeded", summary: { draftIds: [draftId], mustFails: saved.mustFails } };
  }

  if (job.type === "asset") {
    if (!env) return { status: "failed", summary: {}, error: "asset import needs the Worker env" };
    return importAsset(env, job, output as Parameters<typeof importAsset>[2]);
  }

  if (job.type === "page" || kind === "connpass_page" || kind === "connpass_mail") {
    return importPage(
      db,
      job,
      kind as "connpass_page" | "connpass_mail",
      output,
      brief,
      yomiyasu,
      (target, report) => maybeFix(db, job, target, kind, report),
    );
  }

  if (job.type === "post" || job.type === "fix") {
    return importPosts(
      db,
      job,
      kind as "x_post" | "ig_post",
      output as { channel: "x" | "ig"; posts: Record<string, unknown>[]; notes: string | null },
      brief,
      yomiyasu,
    );
  }
  return { status: "failed", summary: {}, error: `cannot import ${job.type}` };
}

async function importPosts(
  db: D1Database,
  job: Job,
  kind: "x_post" | "ig_post",
  output: { channel: "x" | "ig"; posts: Record<string, unknown>[]; notes: string | null },
  brief: Brief | null,
  yomiyasu: Yomiyasu,
): Promise<CompleteOutcome> {
  const payload = job.payload as Record<string, unknown>;
  if (job.type === "fix") {
    const target = payload.target as FixTarget;
    const saved = await saveVersion(db, job, target.id, kind, output, brief, yomiyasu);
    return { status: "succeeded", summary: { draftIds: [target.id], mustFails: saved.mustFails } };
  }
  const ids = (payload.scheduleItemIds as number[]) ?? [];
  const items = (await listItems(db, job.campaignId)).filter((i) => ids.includes(i.id));
  const draftIds: number[] = [];
  const missing: number[] = [];
  for (const item of items) {
    const post =
      output.posts.find((p) => p.scheduleItemId === item.id) ??
      (items.length === 1 && output.posts.length === 1 ? output.posts[0] : undefined);
    if (!post) {
      missing.push(item.id);
      continue;
    }
    const existing = await draftForItem(db, item.id);
    const draftId =
      existing?.id ??
      (await createDraft(db, {
        campaignId: job.campaignId,
        kind,
        title: item.title,
        scheduleItemId: item.id,
        assigneeUserId: item.assigneeUserId,
        reviewerUserId: item.reviewerUserId,
      }));
    await saveVersion(
      db,
      job,
      draftId,
      kind,
      {
        channel: output.channel,
        posts: [{ ...post, scheduleItemId: item.id }],
        notes: output.notes,
      },
      brief,
      yomiyasu,
    );
    draftIds.push(draftId);
  }
  return {
    status: missing.length && !draftIds.length ? "failed" : "succeeded",
    summary: { draftIds, missingItems: missing },
    error: missing.length ? `no post for items ${missing.join(", ")}` : undefined,
  };
}

async function saveVersion(
  db: D1Database,
  job: Job,
  draftId: number,
  kind: DraftKind,
  content: unknown,
  brief: Brief | null,
  yomiyasu: Yomiyasu,
): Promise<{ mustFails: number }> {
  const report = runChecks({ kind: kind as CheckKind, draft: content, brief, yomiyasu });
  const fails = mustFailures(report).length;
  const fixing = fails > 0 && job.type !== "fix";
  const status = fixing ? "generating" : "in_review";
  const version = await appendVersion(db, draftId, {
    author: "agent",
    userId: null,
    jobId: job.id,
    content,
    playbookVersion: PLAYBOOK_VERSION,
    checkResults: report.results,
    status,
    itemStatus: itemStatusFor(status),
  });
  if (fixing) await maybeFix(db, job, { table: "drafts", id: draftId, version }, kind, report);
  return { mustFails: fails };
}

/** One fix per version: a fix never queues another fix. */
async function maybeFix(
  db: D1Database,
  job: Job,
  target: FixTarget,
  kind: string,
  report: CheckReport,
): Promise<void> {
  const failures = mustFailures(report).map((r) => ({ ruleId: r.ruleId, detail: r.detail }));
  if (failures.length === 0 || job.type === "fix") return;
  await insertJob(db, {
    campaignId: job.campaignId,
    payload: { type: "fix", target, kind, failures },
    requestedBy: null,
  });
}

async function briefOf(
  db: D1Database,
  campaignId: number,
  version: number | null,
): Promise<Brief | null> {
  return (
    (
      (version ? await briefVersion(db, campaignId, version) : null) ??
      (await latestBrief(db, campaignId))
    )?.brief ?? null
  );
}

/** Drafts left "generating" by a fix that failed for good go to review so a person sees them. */
export async function releaseFailedFix(db: D1Database, job: Job): Promise<void> {
  if (job.type !== "fix") return;
  const target = (job.payload as { target: FixTarget }).target;
  if (target.table !== "drafts") return;
  const draft = await getDraftById(db, target.id);
  if (draft?.status === "generating") {
    await db.batch([
      db
        .prepare(
          "UPDATE drafts SET status = 'in_review', updated_at = unixepoch() WHERE id = ? AND status = 'generating'",
        )
        .bind(target.id),
      db
        .prepare(
          "UPDATE schedule_items SET status = 'in_review' WHERE id = (SELECT schedule_item_id FROM drafts WHERE id = ?) AND status = 'drafting'",
        )
        .bind(target.id),
    ]);
  }
}
