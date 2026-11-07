import type { CampaignAccess } from "~/features/campaigns/access.server";
import { insertJob, widenQueuedAssist } from "~/features/jobs/job.repository.server";
import { fileKey, readSource } from "./fetch-source.server";
import {
  ATTACHMENT_TYPES,
  type Attachment,
  MAX_ATTACHMENTS,
  MAX_ATTACHMENT_BYTES,
  urlsIn,
} from "./message";
import { insertMessage } from "./message.repository.server";
import { deleteSource, getSource, upsertSource } from "./source.repository.server";

const MAX_BODY = 8000;
const MAX_URLS = 3;

/** Ask the runner to answer everything up to this message (one queued job at a time). */
export async function queueAssist(
  db: D1Database,
  campaignId: number,
  upTo: number,
  userId: string,
) {
  if (await widenQueuedAssist(db, campaignId, upTo)) return;
  await insertJob(db, { campaignId, payload: { type: "assist", upTo }, requestedBy: userId });
}

const randomId = () =>
  [...crypto.getRandomValues(new Uint8Array(9))]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

export type PostResult = { ok: true } | { ok: false; error: string };

/**
 * A person writes in the thread: files go to R2, URLs become sources the Worker reads now (so the
 * runner gets their text and images), and an assist job answers.
 */
export async function postMessage(
  env: Env,
  access: CampaignAccess,
  form: FormData,
): Promise<PostResult> {
  const body = String(form.get("body") ?? "")
    .trim()
    .slice(0, MAX_BODY);
  const files = form
    .getAll("files")
    .filter((f): f is File => f instanceof File && f.size > 0)
    .slice(0, MAX_ATTACHMENTS);
  if (!body && !files.length) return { ok: false, error: "何か書くか、ファイルを添付してください" };
  const attachments: Attachment[] = [];
  for (const file of files) {
    const type = file.type || "text/plain";
    if (!ATTACHMENT_TYPES.includes(type))
      return {
        ok: false,
        error: `${file.name}: 画像（PNG / JPEG / WebP）かテキストを添付してください`,
      };
    if (file.size > MAX_ATTACHMENT_BYTES)
      return { ok: false, error: `${file.name}: 4 MB までにしてください` };
    const id = `att-${randomId()}`;
    await env.IMAGES.put(fileKey(access.campaign.id, id), await file.arrayBuffer(), {
      httpMetadata: { contentType: type },
    });
    attachments.push({ id, name: file.name.slice(0, 120), type, size: file.size });
  }
  for (const url of urlsIn(body).slice(0, MAX_URLS)) {
    const id = await upsertSource(env.DB, access.campaign.id, url, access.user.id);
    await readSource(env, access.campaign.id, id);
  }
  const messageId = await insertMessage(env.DB, {
    campaignId: access.campaign.id,
    author: "user",
    userId: access.user.id,
    userName: access.user.name,
    body,
    attachments,
  });
  if (!messageId) return { ok: false, error: "保存できませんでした" };
  await queueAssist(env.DB, access.campaign.id, messageId, access.user.id);
  return { ok: true };
}

/** Read a source again (the page changed) and let the assistant compare. */
export async function refreshSource(
  env: Env,
  access: CampaignAccess,
  sourceId: number,
): Promise<PostResult> {
  const source = await readSource(env, access.campaign.id, sourceId);
  if (!source) return { ok: false, error: "情報源が見つかりません" };
  const messageId = await insertMessage(env.DB, {
    campaignId: access.campaign.id,
    author: "user",
    userId: access.user.id,
    userName: access.user.name,
    body: `「${source.title || source.url}」を読み直しました。前と変わったところを brief に反映してください。\n${source.url}`,
  });
  if (messageId) await queueAssist(env.DB, access.campaign.id, messageId, access.user.id);
  return source.status === "error"
    ? { ok: false, error: source.error ?? "読めませんでした" }
    : { ok: true };
}

export async function removeSource(env: Env, access: CampaignAccess, sourceId: number) {
  const source = await getSource(env.DB, access.campaign.id, sourceId);
  if (!source) return;
  const keys = [
    ...(source.textKey ? [source.textKey] : []),
    ...source.images.map((i) => fileKey(access.campaign.id, i.id)),
  ];
  if (keys.length) await env.IMAGES.delete(keys);
  await deleteSource(env.DB, access.campaign.id, sourceId);
}
