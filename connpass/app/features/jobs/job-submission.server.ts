import { getJob, insertQueuedJob } from "./job-repository.server";
import type { JobQueueMessage, JobRecord, NewJobInput } from "./job-types";
export async function createJob(
  env: Env,
  input: NewJobInput,
  ctx?: ExecutionContext,
): Promise<JobRecord> {
  const id = await insertQueuedJob(env.DB, input);
  await env.JOB_QUEUE.send({ jobId: id } satisfies JobQueueMessage);
  // Vite local queue consumers often never fire; run the worker inline in dev.
  if (import.meta.env.DEV && ctx) {
    ctx.waitUntil(
      import("./job-runner.server").then((mod) =>
        mod.processJobMessage(env, ctx, { jobId: id } satisfies JobQueueMessage),
      ),
    );
  }
  const job = await getJob(env.DB, id);
  if (!job) throw new Error("job_create_failed");
  return job;
}
