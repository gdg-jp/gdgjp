import { rollup } from "~/features/dispatch/dispatch.server";
import { moveTarget } from "~/features/dispatch/target.repository.server";
import { callRpc, connpassService, parseActor } from "~/features/integrations/bindings.server";
import { transitionItem } from "~/features/schedule/item.repository.server";
import { openConnpassJobs, setConnpassJobStatus } from "./job-ledger.server";

/** Hourly: follow connpass jobs pr submitted, as their submitter; finish their item or target. */
export async function pollConnpassJobs(env: Env): Promise<{ checked: number; finished: number }> {
  let finished = 0;
  const open = await openConnpassJobs(env.DB);
  for (const row of open) {
    const actor = parseActor(row.actorSnapshot);
    if (!actor) continue;
    const result = await callRpc(() => connpassService(env).getJob({ actor, jobId: row.jobId }));
    if (!result.ok) continue;
    const { status, error } = result.job;
    if (status === row.status || !(await setConnpassJobStatus(env.DB, row.jobId, status, error)))
      continue;
    if (status !== "succeeded" && status !== "failed") continue;
    finished++;
    if (row.targetId) {
      await moveTarget(
        env.DB,
        row.targetId,
        ["scheduled", "dispatching"],
        status === "succeeded" ? "done" : "failed",
        { error },
      );
      if (row.itemId) await rollup(env, row.itemId);
    } else if (row.itemId) {
      await transitionItem(
        env.DB,
        row.itemId,
        ["scheduled", "dispatching", "approved"],
        status === "succeeded" ? "done" : "failed",
      );
    }
  }
  return { checked: open.length, finished };
}
