import { BRIEF_SCHEMA, emptyBrief } from "~/features/briefs/brief";
import type { Campaign } from "~/features/campaigns/campaign";
import type { Job } from "~/features/jobs/shared";
import { toJstLocal } from "~/features/schedule/calendar";
import { fileKey } from "./fetch-source.server";
import type { Message } from "./message";
import { listMessages } from "./message.repository.server";
import { listSources } from "./source.repository.server";
import { campaignState, isoJst } from "./state.server";

/** Images and files the runner gets beside the text files, newest first, within this much. */
const MAX_BINARY_BYTES = 12 * 1024 * 1024;
const MAX_IMAGES = 24;
const EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};

const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;

function toBase64(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 0x8000)
    out += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(out);
}

function threadMd(messages: Message[], paths: Map<string, string>): string {
  const lines = ["# スレッド", ""];
  for (const m of messages) {
    const who = m.author === "user" ? `人（${m.userName ?? "メンバー"}）` : "秘書";
    lines.push(`## ${who} ${isoJst(m.createdAt)}`, "", m.body || "（本文なし）");
    for (const a of m.attachments)
      lines.push(`- 添付: ${paths.get(a.id) ?? `${a.name}（大きすぎて渡していない）`}`);
    if (m.meta.briefChanges?.length)
      lines.push(`- brief を更新（版 ${m.meta.briefVersion}）: ${m.meta.briefChanges.join(" / ")}`);
    for (const q of m.questions) lines.push(`- 質問: ${q}`);
    for (const a of m.actions)
      lines.push(
        `- ボタン「${a.label}」（${a.type}）: ${a.status}${a.result ? ` — ${a.result}` : ""}`,
      );
    lines.push("");
  }
  return lines.join("\n");
}

/**
 * The assist job's files: the thread, the brief (or a stub), the campaign's state, and every
 * source and attachment the Worker collected. Images go as binary files the runner attaches.
 */
export async function assistBundle(
  env: Env,
  job: Job,
  campaign: Campaign,
  files: Record<string, string>,
  task: string[],
): Promise<{ binaryFiles: Record<string, string>; images: string[] }> {
  const upTo = Number((job.payload as { upTo?: number }).upTo ?? Number.MAX_SAFE_INTEGER);
  const [messages, sources, { state, brief }] = await Promise.all([
    listMessages(env.DB, campaign.id, 40),
    listSources(env.DB, campaign.id),
    campaignState(env, campaign),
  ]);
  const thread = messages.filter((m) => m.id <= upTo);
  const binaryFiles: Record<string, string> = {};
  const images: string[] = [];
  const paths = new Map<string, string>();
  let budget = MAX_BINARY_BYTES;
  const take = async (key: string, path: string, type: string) => {
    if (images.length >= MAX_IMAGES) return false;
    const object = await env.IMAGES.get(key);
    if (!object || object.size > budget) return false;
    budget -= object.size;
    const bytes = new Uint8Array(await object.arrayBuffer());
    if (type.startsWith("text/")) files[path] = new TextDecoder().decode(bytes);
    else {
      binaryFiles[path] = toBase64(bytes);
      images.push(path);
    }
    return true;
  };

  for (const m of [...thread].reverse())
    for (const a of m.attachments) {
      const path = `attachments/${a.id}.${EXT[a.type] ?? "txt"}`;
      if (await take(fileKey(campaign.id, a.id), path, a.type)) paths.set(a.id, path);
    }
  const sourceLines = ["# 情報源", ""];
  for (const s of [...sources].reverse()) {
    sourceLines.push(
      `## ${s.id}: ${s.title || s.url}`,
      "",
      `- URL: ${s.url}`,
      `- 状態: ${s.status}`,
    );
    if (s.error) sourceLines.push(`- error: ${s.error}`);
    if (s.fetchedAt) sourceLines.push(`- 読んだ日時: ${isoJst(s.fetchedAt)}`);
    if (s.textKey) {
      const text = await env.IMAGES.get(s.textKey);
      if (text) {
        files[`sources/${s.id}.txt`] = await text.text();
        sourceLines.push(`- 本文: sources/${s.id}.txt`);
      }
    }
    for (const img of s.images) {
      const path = `sources/${s.id}/${img.id}.${EXT[img.type] ?? "img"}`;
      if (await take(fileKey(campaign.id, img.id), path, img.type))
        sourceLines.push(`- 画像: ${path}${img.src ? `（${img.src}）` : ""}`);
    }
    sourceLines.push("");
  }
  files["THREAD.md"] = threadMd(thread, paths);
  files["SOURCES.md"] = sources.length ? sourceLines.join("\n") : "# 情報源\n\nまだありません。\n";
  files["STATE.json"] = json(state);
  files["BRIEF.json"] = json(
    brief ??
      emptyBrief(
        campaign.name,
        campaign.eventAt ? `${toJstLocal(campaign.eventAt)}:00+09:00` : null,
        campaign.venue,
      ),
  );
  files["skills/pr-playbook/references/brief.schema.json"] = json(BRIEF_SCHEMA);

  task.push(
    "このイベントのスレッド（THREAD.md）で、最後の秘書の発言より後の人の発言に答える。",
    "情報源（SOURCES.md、sources/、attachments/）を読み、brief（BRIEF.json）を更新し、次にやることをボタンで出す。",
  );
  if (images.length) task.push("", "画像（必ず開いて見る）:", ...images.map((p) => `- ${p}`));
  const errors = (job.payload as { briefErrors?: string[] }).briefErrors;
  if (errors?.length)
    task.push(
      "",
      "## 前回の briefJson は brief.schema.json に合わなかった。直して返す",
      ...errors.map((e) => `- ${e}`),
    );
  return { binaryFiles, images };
}
