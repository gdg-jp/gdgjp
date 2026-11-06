import { callRpc, parseActor, snsService } from "~/features/integrations/bindings.server";
import { transitionItem } from "~/features/schedule/item.repository.server";
import { logDispatch } from "./log.server";
import { rollupItemStatus } from "./target";
import { listTargets, moveTarget, scheduledTargets } from "./target.repository.server";

/**
 * Hourly: follow each scheduled sns post as the person who approved it. A missing snapshot or
 * a refusal is logged and skipped; it never stops the sweep.
 */
export async function pollScheduledPosts(env: Env): Promise<{ checked: number; changed: number }> {
  let changed = 0;
  const targets = await scheduledTargets(env.DB);
  for (const target of targets) {
    const actor = parseActor(target.actorSnapshot);
    const postId = target.externalRef?.snsPostId;
    const base = { campaignId: target.account.campaignId, itemId: target.scheduleItemId };
    if (!actor || !postId) {
      await logDispatch(env.DB, { ...base, action: "sns_poll", ok: false, detail: "no_actor" });
      continue;
    }
    const result = await callRpc(() =>
      snsService(env).getPost({ actor, chapterId: target.account.chapterId, postId }),
    );
    if (!result.ok) {
      await logDispatch(env.DB, {
        ...base,
        action: "sns_poll",
        ok: false,
        detail: `${result.code} ${result.message ?? ""}`.trim(),
      });
      continue;
    }
    const { post } = result;
    if (post.status === "published" || post.status === "failed") {
      const to = post.status === "published" ? "done" : "failed";
      await moveTarget(env.DB, target.id, ["scheduled"], to, {
        externalRef: { snsPostId: postId, publishedXPostId: post.publishedXPostId },
        error: post.failureReason,
      });
      await logDispatch(env.DB, {
        ...base,
        action: "sns_poll",
        ok: to === "done",
        detail: post.status,
      });
      const status = rollupItemStatus(
        (await listTargets(env.DB, target.scheduleItemId)).map((t) => t.status),
      );
      if (status)
        await transitionItem(
          env.DB,
          target.scheduleItemId,
          ["dispatching", "scheduled", "failed"],
          status,
        );
      changed++;
    }
  }
  return { checked: targets.length, changed };
}
