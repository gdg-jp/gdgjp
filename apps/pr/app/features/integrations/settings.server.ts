import type { CampaignAccess } from "~/features/campaigns/access.server";
import { updateCampaign } from "~/features/campaigns/campaign.repository.server";
import { listDispatchLog } from "~/features/dispatch/log.server";
import { healthState } from "~/features/links/link";
import { listCampaignChannels, listLinks } from "~/features/links/link.repository.server";
import { maskedDiscordWebhook } from "~/features/settings/chapter-settings.server";
import { ACCOUNT_KIND_LABELS, type AccountKind } from "./account";
import { addAccount, listAccounts, removeAccount } from "./account.repository.server";
import { activateCampaign } from "./activate.server";
import { actorOf, callRpc, snsService } from "./bindings.server";
import { checkPosting } from "./permission-check.server";

/** The delivery half of /c/:slug/settings. */
export async function deliverySettings(env: Env, access: CampaignAccess) {
  const { campaign } = access;
  const chapterIds = [campaign.chapterId, ...access.campaignChapters.map((c) => c.chapterId)];
  const chapterSlugs = Object.fromEntries([
    [campaign.chapterId, campaign.chapterSlug],
    ...access.campaignChapters.map((c) => [c.chapterId, c.chapterSlug]),
  ]);
  const accounts = await listAccounts(env.DB, campaign.id);
  // The X accounts the viewer can add: sns's accounts of each campaign chapter they are in.
  const addable: { chapterId: number; chapterSlug: string; id: string; username: string }[] = [];
  for (const chapterId of new Set(chapterIds)) {
    if (!access.chapters.some((c) => c.chapterId === chapterId)) continue;
    const listed = await callRpc(() =>
      snsService(env).listXAccounts({ actor: actorOf(access), chapterId }),
    );
    if (!listed.ok) continue;
    for (const a of listed.accounts)
      if (!accounts.some((x) => x.kind === "x" && x.externalId === a.id))
        addable.push({
          chapterId,
          chapterSlug: chapterSlugs[chapterId] ?? String(chapterId),
          id: a.id,
          username: a.username,
        });
  }
  const checks = await checkPosting(env, campaign.id, accounts);
  const links = await listLinks(env.DB, campaign.id);
  return {
    autoStaffReminders: campaign.autoStaffReminders,
    accounts: accounts.map((a) => ({
      id: a.id,
      kind: ACCOUNT_KIND_LABELS[a.kind],
      label: a.label,
      chapterSlug: chapterSlugs[a.chapterId] ?? String(a.chapterId),
      role: a.role,
      check: checks.find((c) => c.accountId === a.id) ?? null,
    })),
    addable,
    chapters: [...new Set(chapterIds)].map((id) => ({ id, slug: chapterSlugs[id] ?? String(id) })),
    channels: await listCampaignChannels(env.DB, campaign.id),
    links: links.map((l) => ({
      id: l.id,
      shortUrl: l.shortUrl,
      destinationUrl: l.destinationUrl,
      health: healthState(l),
    })),
    webhook: await maskedDiscordWebhook(env, campaign.chapterId),
    log: await listDispatchLog(env.DB, campaign.id, 20),
  };
}

export async function deliverySettingsAction(
  env: Env,
  access: CampaignAccess,
  intent: string,
  form: FormData,
): Promise<{ ok: boolean; error: string | null; message?: string } | null> {
  const { campaign } = access;
  if (intent === "activate") {
    const result = await activateCampaign(env, access);
    return result.ok
      ? { ok: true, error: null, message: `有効化しました（チャネル ${result.channels} 本）` }
      : { ok: false, error: result.error };
  }
  if (intent === "auto-reminders") {
    await updateCampaign(env.DB, campaign.id, { autoStaffReminders: form.get("auto") === "on" });
    return { ok: true, error: null, message: "スタッフへの依頼の送り方を保存しました" };
  }
  if (intent === "add-x") {
    const [chapterRaw, id, username] = String(form.get("account") ?? "").split("|");
    const chapterId = Number(chapterRaw);
    if (!id || !access.chapters.some((c) => c.chapterId === chapterId))
      return { ok: false, error: "そのチャプターのアカウントは追加できません" };
    await addAccount(env.DB, {
      campaignId: campaign.id,
      kind: "x",
      chapterId,
      externalId: id,
      label: `@${username}`,
      role: chapterId === campaign.chapterId ? "primary" : "mirror",
    });
    return { ok: true, error: null, message: `@${username} を配信先に追加しました` };
  }
  if (intent === "add-handle") {
    const kind = String(form.get("kind")) as AccountKind;
    const handle = String(form.get("handle") ?? "")
      .trim()
      .replace(/^@/, "");
    const chapterId = Number(form.get("chapter"));
    if (!(kind in ACCOUNT_KIND_LABELS) || kind === "x" || !handle)
      return { ok: false, error: "種類とハンドルを入れてください" };
    if (!access.chapters.some((c) => c.chapterId === chapterId) && !access.user.isAdmin)
      return { ok: false, error: "自分のチャプターのアカウントだけ追加できます" };
    await addAccount(env.DB, {
      campaignId: campaign.id,
      kind,
      chapterId,
      externalId: handle,
      label: kind === "ig" ? `@${handle}` : handle,
      role: chapterId === campaign.chapterId ? "primary" : "mirror",
    });
    return { ok: true, error: null, message: "追加しました" };
  }
  if (intent === "remove-account") {
    await removeAccount(env.DB, campaign.id, Number(form.get("account")));
    return { ok: true, error: null, message: "外しました" };
  }
  return null;
}
