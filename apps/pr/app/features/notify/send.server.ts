import { logDispatch } from "~/features/dispatch/log.server";
import { constants } from "~/features/playbook/playbook";
import { discordWebhookFor } from "~/features/settings/chapter-settings.server";
import { renderTemplate } from "./discord";
import { claimNotification, sendDiscord } from "./discord.server";

export type TemplateName = keyof typeof constants.reminders.templates;

/** The Playbook's default text (constants.reminders.templates); never written in TS. */
export const template = (name: TemplateName, vars: Record<string, string | null | undefined>) =>
  renderTemplate(constants.reminders.templates[name], vars);

/**
 * Send to a chapter's Discord webhook once per `key`. Missing webhooks and failures are
 * logged once (without the URL): a claimed key is never retried, so nothing repeats every minute.
 */
export async function notifyChapter(
  env: Env,
  input: {
    chapterId: number;
    campaignId: number;
    itemId: number | null;
    key: string;
    content: string;
    action: string;
  },
): Promise<"sent" | "duplicate" | "no_webhook" | "failed"> {
  if (!(await claimNotification(env.DB, input.key))) return "duplicate";
  const webhook = await discordWebhookFor(env, input.chapterId);
  if (!webhook) {
    await logDispatch(env.DB, { ...input, ok: false, detail: "no_webhook" });
    return "no_webhook";
  }
  const result = await sendDiscord(webhook, input.content);
  await logDispatch(env.DB, {
    campaignId: input.campaignId,
    itemId: input.itemId,
    action: input.action,
    ok: result.ok,
    detail: result.ok ? input.key : result.error,
  });
  return result.ok ? "sent" : "failed";
}
