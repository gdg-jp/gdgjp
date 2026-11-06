import { mustFailures } from "@skills/pr-playbook/scripts/checks/index.mjs";
import type { Brief } from "~/features/briefs/brief";
import {
  appendVersion,
  createDraft,
  draftForItem,
  getDraftById,
  listDrafts,
} from "~/features/drafts/draft.repository.server";
import { itemStatusFor } from "~/features/drafts/state-machine";
import { type ConnpassPageContent, withRenderedHtml } from "~/features/pages/render";
import { connpassSectionTemplates } from "~/features/playbook/guides.server";
import { PLAYBOOK_VERSION, runChecks } from "~/features/playbook/playbook";
import { getItem } from "~/features/schedule/item.repository.server";
import type { CompleteOutcome } from "./complete.server";
import type { FixTarget, Job } from "./shared";

type Yomiyasu = { status: "pass" | "fail" | "unevaluated"; detail?: string } | null;

/** The connpass page: one draft per campaign (a new page job adds a version). */
async function pageDraft(db: D1Database, job: Job): Promise<number> {
  const payload = job.payload as { draftId?: number };
  if (payload.draftId) return payload.draftId;
  const existing = (await listDrafts(db, job.campaignId)).find(
    (d) => d.kind === "connpass_page" && d.status !== "superseded" && d.status !== "rejected",
  );
  return (
    existing?.id ??
    (await createDraft(db, {
      campaignId: job.campaignId,
      kind: "connpass_page",
      title: "connpass ページ",
      scheduleItemId: null,
    }))
  );
}

/** A connpass mail belongs to its connpass_mail schedule item. */
async function mailDraft(db: D1Database, job: Job): Promise<number | null> {
  const itemId = (job.payload as { scheduleItemId?: number }).scheduleItemId;
  const item = itemId ? await getItem(db, job.campaignId, itemId) : null;
  if (!item) return null;
  return (
    (await draftForItem(db, item.id))?.id ??
    (await createDraft(db, {
      campaignId: job.campaignId,
      kind: "connpass_mail",
      title: item.title,
      scheduleItemId: item.id,
      assigneeUserId: item.assigneeUserId,
      reviewerUserId: item.reviewerUserId,
    }))
  );
}

/**
 * `page` jobs (and their fixes): the page's HTML is rebuilt from the slots here, so the agent's
 * own `html`, if any, never reaches connpass. A MUST failure gets the usual single fix.
 */
export async function importPage(
  db: D1Database,
  job: Job,
  kind: "connpass_page" | "connpass_mail",
  output: unknown,
  brief: Brief | null,
  yomiyasu: Yomiyasu,
  queueFix: (target: FixTarget, report: ReturnType<typeof runChecks>) => Promise<void>,
): Promise<CompleteOutcome> {
  const fixTarget = job.type === "fix" ? (job.payload as { target: FixTarget }).target : null;
  const draftId = fixTarget
    ? fixTarget.id
    : kind === "connpass_page"
      ? await pageDraft(db, job)
      : await mailDraft(db, job);
  if (!draftId || !(await getDraftById(db, draftId)))
    return { status: "failed", summary: {}, error: "no schedule item for this mail" };
  const content =
    kind === "connpass_page"
      ? withRenderedHtml(output as ConnpassPageContent, brief, connpassSectionTemplates)
      : output;
  const report = runChecks({ kind, draft: content, brief, yomiyasu });
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
  if (fixing) await queueFix({ table: "drafts", id: draftId, version }, report);
  return { status: "succeeded", summary: { draftIds: [draftId], mustFails: fails } };
}
