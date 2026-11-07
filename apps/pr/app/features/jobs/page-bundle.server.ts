import { KIT_TEMPLATE, referenceKindFor } from "~/features/assets/asset";
import { getAsset, kitAssets } from "~/features/assets/asset.repository.server";
import { ensureDesignFiles } from "~/features/assets/photos.server";
import { buildHtml } from "~/features/assets/render.server";
import type { Brief } from "~/features/briefs/brief";
import type { Campaign } from "~/features/campaigns/campaign";
import { listReferences, pickReferences } from "~/features/design/reference.repository.server";
import { latestVersion } from "~/features/drafts/draft.repository.server";
import { adoptedPlan } from "~/features/plans/plan.repository.server";
import {
  designAssets,
  exampleOutputFilesByPath,
  imageTemplates,
  templates,
} from "~/features/playbook/guides.server";
import { constants } from "~/features/playbook/playbook";
import { jstDate, jstTime } from "~/features/schedule/calendar";
import { getItem, listItems } from "~/features/schedule/item.repository.server";
import { approvedCopy } from "./bundle.server";

const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;
const iso = (epoch: number) => `${jstDate(epoch)}T${jstTime(epoch)}:00+09:00`;

const bytesToBase64 = (bytes: ArrayBuffer) => {
  let binary = "";
  const view = new Uint8Array(bytes);
  for (let i = 0; i < view.length; i += 0x8000)
    binary += String.fromCharCode(...view.subarray(i, i + 0x8000));
  return btoa(binary);
};
const EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

/** What a `page` job adds to the bundle: copy, plan, the section templates, images, the mail's item. */
export async function pageFiles(
  db: D1Database,
  campaign: Campaign,
  payload: Record<string, unknown>,
  files: Record<string, string>,
  task: string[],
): Promise<void> {
  const copy = await approvedCopy(db, campaign.id);
  if (copy) files["COPY.json"] = json(copy);
  const plan = await adoptedPlan(db, campaign.id);
  if (plan) files["PLAN.json"] = json(plan.body);
  if (payload.kind === "connpass_mail") {
    const item =
      typeof payload.scheduleItemId === "number"
        ? await getItem(db, campaign.id, payload.scheduleItemId)
        : null;
    if (item)
      files["SCHEDULE.json"] = json({
        target: {
          scheduleItemId: item.id,
          title: item.title,
          scheduledAt: iso(item.dueAt),
          purpose: item.purpose,
          note: item.note,
        },
        context: (await listItems(db, campaign.id))
          .filter((i) => i.kind === "connpass_mail" && i.id !== item.id)
          .map((i) => ({ title: i.title, at: iso(i.dueAt) })),
      });
    task.push(
      "SCHEDULE.json の target の connpass メールを 1 通書く。scheduledAt は target の値を使う。",
      copy ? "COPY.json の採用コピーに沿って書く。" : "",
    );
    return;
  }
  for (const [path, text] of Object.entries(templates))
    if (path.startsWith("pr-playbook/templates/connpass-page/")) files[`skills/${path}`] = text;
  const images = (payload.imageUrls ?? {}) as Record<string, string>;
  files["IMAGES.json"] = json(images);
  task.push(
    "brief と採用コピー（COPY.json）から connpass ページのセクションを組む。HTML は書かず、スロットだけを返す。",
    "使える画像は IMAGES.json の URL だけ（セクション id → URL）。無い画像は imageUrl を null にし、imageSlots に載せる。",
    "描画して確かめる: node skills/pr-playbook/scripts/render/run.mjs --input /dev/stdin <<'JSON' … JSON",
  );
}

export type AssetExtra = {
  binaryFiles: Record<string, string>;
  images: string[];
  workspaceWrite: true;
  render: true;
};

/**
 * What an `asset` job adds: the design guide's examples, the template's contract, the adopted kit
 * (KIT.json + KIT.html), the GDG logo and stickers as `assets/`, the speakers' photos, the
 * chapter's reference designs (attached as images, newest first), copy, the post's text, and for
 * a revision the previous HTML and PNG with the person's instructions.
 */
export async function assetFiles(
  env: Env,
  campaign: Campaign,
  brief: Brief,
  payload: Record<string, unknown>,
  files: Record<string, string>,
  task: string[],
): Promise<AssetExtra> {
  const db = env.DB;
  const purpose = payload.purpose === "kit" ? "kit" : "image";
  const templateId = purpose === "kit" ? KIT_TEMPLATE : String(payload.templateId ?? "");
  const dir = `pr-playbook/templates/images/${templateId}/`;
  for (const [path, text] of Object.entries(templates))
    if (
      path.startsWith(dir) ||
      path === "pr-playbook/templates/images/README.md" ||
      path === "pr-playbook/templates/images/base.css"
    )
      files[`skills/${path}`] = text;
  for (const [path, text] of Object.entries(designAssets.examples)) files[`skills/${path}`] = text;
  files["skills/pr-asset/references/example-template-output.json"] =
    exampleOutputFilesByPath["pr-asset/references/example-template-output.json"] ?? "{}";
  files["skills/pr-playbook/scripts/render/checks-script.js"] = imageTemplates.checksScript;
  files["skills/gdg-design/assets/gdg.svg"] = imageTemplates.logoSvg;
  files["assets/gdg.svg"] = imageTemplates.logoSvg;
  for (const [file, svg] of Object.entries(designAssets.stickers))
    files[`assets/stickers/${file}`] = svg;

  const binaryFiles: Record<string, string> = {};
  const images: string[] = [];
  const kit = await kitAssets(db, campaign.id);
  if (kit.adopted?.notes.kit && purpose !== "kit") {
    files["KIT.json"] = json(kit.adopted.notes.kit);
    if (kit.adopted.html) files["KIT.html"] = kit.adopted.html;
  }
  const copy = await approvedCopy(db, campaign.id);
  if (copy) files["COPY.json"] = json(copy);
  if (typeof payload.forDraftId === "number") {
    const version = await latestVersion(db, payload.forDraftId);
    if (version) files["POST.json"] = json(version.content);
  }

  // Which people are in the picture: the job's speaker or session, or the headliners for the face.
  const item =
    typeof payload.forScheduleItemId === "number"
      ? await getItem(db, campaign.id, payload.forScheduleItemId)
      : null;
  const sessionId = (payload.sessionId as string | undefined) ?? item?.sessionId ?? null;
  const session = sessionId ? brief.sessions.find((s) => s.id === sessionId) : null;
  const speakerIds = new Set<string>();
  if (typeof payload.speakerId === "string") speakerIds.add(payload.speakerId);
  if (item?.speakerId) speakerIds.add(item.speakerId);
  for (const id of session?.speakerIds ?? []) speakerIds.add(id);
  if (
    purpose === "kit" ||
    templateId === KIT_TEMPLATE ||
    templateId.startsWith("x-ad") ||
    templateId.startsWith("ig-")
  )
    for (const s of brief.speakers.filter((s) => s.tier === "high").slice(0, 4))
      speakerIds.add(s.id);
  const designFiles = await ensureDesignFiles(env, campaign.id, brief, [...speakerIds]);
  for (const ref of designFiles.refs)
    binaryFiles[`assets/${ref}`] = bytesToBase64(designFiles.bytes[ref] as ArrayBuffer);
  if (session)
    files["SESSION.json"] = json({
      ...session,
      speakers: brief.speakers.filter((s) => session.speakerIds.includes(s.id)),
    });
  else if (speakerIds.size)
    files["SPEAKERS.json"] = json(brief.speakers.filter((s) => speakerIds.has(s.id)));

  // Reference designs: the chapter's library (newest first), then the brief's own references.
  const limit = constants.design.referenceImagesPerJob;
  const picked = pickReferences(
    await listReferences(db, campaign.chapterId),
    purpose === "kit" ? "kit" : referenceKindFor(templateId),
    limit,
  );
  const notes: string[] = [];
  for (const [i, ref] of picked.entries()) {
    const object = await env.IMAGES.get(ref.r2Key);
    if (!object) continue;
    const path = `references/${ref.madeOn || "undated"}-${ref.kind}-${i + 1}.${EXT[ref.contentType] ?? "jpg"}`;
    binaryFiles[path] = bytesToBase64(await object.arrayBuffer());
    images.push(path);
    notes.push(`- ${path}: ${[ref.event, ref.note].filter(Boolean).join(" — ") || ref.kind}`);
  }
  const briefRefs = (brief.skin?.referenceAssetUrls ?? []).slice(0, 2);
  for (const [i, url] of briefRefs.entries()) {
    try {
      const response = await fetch(url, {
        headers: { accept: "image/*" },
        signal: AbortSignal.timeout(15_000),
      });
      const type = (response.headers.get("content-type") ?? "").split(";")[0]?.trim() ?? "";
      if (!response.ok || !EXT[type]) continue;
      const bytes = await response.arrayBuffer();
      if (bytes.byteLength > 2_500_000) continue;
      const path = `references/brief-${i + 1}.${EXT[type]}`;
      binaryFiles[path] = bytesToBase64(bytes);
      images.push(path);
      notes.push(`- ${path}: brief の skin.referenceAssetUrls（前回の画像）`);
    } catch {}
  }
  if (notes.length)
    files["REFERENCES.md"] =
      `# 参考画像\n\n新しいものほど重く見る。同じにしない。\n\n${notes.join("\n")}\n`;

  // A revision: what was there and what the person said.
  if (typeof payload.revisionOf === "number") {
    const previous = await getAsset(db, campaign.id, payload.revisionOf);
    if (previous) {
      files["PREVIOUS.html"] = previous.html ?? buildHtml(previous).html;
      files["PREVIOUS.json"] = json({
        rationaleMd: previous.notes.rationaleMd ?? null,
        selfReviewMd: previous.notes.selfReviewMd ?? null,
        checks: previous.checks.filter((c) => c.status === "fail"),
      });
      const png = previous.r2Key ? await env.IMAGES.get(previous.r2Key) : null;
      if (png) {
        binaryFiles["PREVIOUS.png"] = bytesToBase64(await png.arrayBuffer());
        images.push("PREVIOUS.png");
      }
    }
  }
  if (Array.isArray(payload.failures)) files["CHECKS.json"] = json(payload.failures);

  task.push(
    purpose === "kit"
      ? "このイベントのデザインキットを決め、顔（connpass-thumbnail）の方向案を 2〜3 件、HTML で作る（directions）。"
      : `テンプレート ${templateId}（skills/${dir}slots.schema.json のサイズと必須スロット）の画像を 1 枚、HTML で作る。`,
    files["KIT.json"]
      ? "KIT.json がこのイベントのキット、KIT.html が顔。その範囲で作る（新しい色や書体を足さない）。skinSource は kit。"
      : purpose === "kit"
        ? ""
        : "キットはまだ無い。guides/design.md の手順で色とモチーフを決め、kit にも書いて返す。",
    files["SESSION.json"]
      ? "SESSION.json のセッションと登壇者の紹介。写真は assets/photos/ にある分だけ使う。"
      : "",
    files["SPEAKERS.json"]
      ? "SPEAKERS.json の登壇者。写真は assets/photos/ にある分だけ使う。"
      : "",
    files["REFERENCES.md"] ? "REFERENCES.md の参考画像（添付済み）を見る。" : "",
    copy ? "COPY.json の採用コピーに沿う。" : "",
    files["POST.json"]
      ? "POST.json の投稿に添える画像として、本文と重複しすぎない見出しにする。"
      : "",
    files["PREVIOUS.html"]
      ? "PREVIOUS.html / PREVIOUS.png は前の版。人の指示に従って直し、良い所は残す。"
      : "",
    files["CHECKS.json"] ? "CHECKS.json は前の版で落ちた MUST。必ず直す。" : "",
    `描画して見る: node skills/pr-playbook/scripts/render/images.mjs --html draft.html --template ${templateId} --assets . --out out/ のあと、out/${templateId}.png を view_image で開く。`,
  );
  return { binaryFiles, images, workspaceWrite: true, render: true };
}
