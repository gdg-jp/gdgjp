import { sendDueMails } from "~/features/connpass/mail.server";
import { pollConnpassJobs } from "~/features/connpass/poll.server";
import { pollScheduledPosts } from "~/features/dispatch/poll.server";
import { sweepReminders } from "~/features/dispatch/reminders.server";
import { requeueExpired } from "~/features/jobs/job.repository.server";
import { checkLinkHealth } from "~/features/links/health.server";

/** Keep both in sync with [triggers] crons in wrangler.toml. */
export const MINUTE_CRON = "* * * * *";
export const HOURLY_CRON = "0 * * * *";

/** Each job runs on its own; one failing never stops the others. */
export async function runCron(env: Env, cron: string): Promise<Record<string, unknown>> {
  const jobs: Record<string, () => Promise<unknown>> =
    cron === HOURLY_CRON
      ? {
          poll: () => pollScheduledPosts(env),
          connpass: () => pollConnpassJobs(env),
          links: () => checkLinkHealth(env),
        }
      : cron === MINUTE_CRON
        ? {
            requeue: () => requeueExpired(env.DB),
            reminders: () => sweepReminders(env),
            mails: () => sendDueMails(env),
          }
        : {};
  const out: Record<string, unknown> = {};
  for (const [name, job] of Object.entries(jobs)) {
    try {
      out[name] = await job();
    } catch (error) {
      console.error(`[scheduled] ${name} failed`, error);
      out[name] = { error: error instanceof Error ? error.message : String(error) };
    }
  }
  return out;
}
