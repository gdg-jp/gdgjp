import type { Campaign } from "~/features/campaigns/campaign";
import { latestVersion } from "~/features/drafts/draft.repository.server";
import { adoptedPlan } from "~/features/plans/plan.repository.server";
import { imageTemplates, templates } from "~/features/playbook/guides.server";
import { jstDate, jstTime } from "~/features/schedule/calendar";
import { getItem, listItems } from "~/features/schedule/item.repository.server";
import { approvedCopy } from "./bundle.server";

const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;
const iso = (epoch: number) => `${jstDate(epoch)}T${jstTime(epoch)}:00+09:00`;

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

/** What an `asset` job adds: the template, its slot contract, the skin, copy and the post's text. */
export async function assetFiles(
  db: D1Database,
  campaign: Campaign,
  payload: Record<string, unknown>,
  files: Record<string, string>,
  task: string[],
): Promise<void> {
  const templateId = String(payload.templateId ?? "");
  const dir = `pr-playbook/templates/images/${templateId}/`;
  for (const [path, text] of Object.entries(templates))
    if (
      path.startsWith(dir) ||
      path === "pr-playbook/templates/images/README.md" ||
      path === "pr-playbook/templates/images/base.css"
    )
      files[`skills/${path}`] = text;
  files["skills/pr-playbook/scripts/render/checks-script.js"] = imageTemplates.checksScript;
  files["skills/gdg-design/assets/gdg.svg"] = imageTemplates.logoSvg;
  const copy = await approvedCopy(db, campaign.id);
  if (copy) files["COPY.json"] = json(copy);
  if (typeof payload.forDraftId === "number") {
    const version = await latestVersion(db, payload.forDraftId);
    if (version) files["POST.json"] = json(version.content);
  }
  if (Array.isArray(payload.failures)) files["CHECKS.json"] = json(payload.failures);
  task.push(
    `テンプレート ${templateId} のスロットを埋める（skills/${dir}slots.schema.json）。`,
    "使わないスロットは null。layoutVars は範囲の中だけ。",
    copy ? "COPY.json の採用コピーに沿う。" : "",
    files["POST.json"]
      ? "POST.json の投稿に添える画像として、本文と重複しすぎない見出しにする。"
      : "",
    `描画して確かめる: node skills/pr-playbook/scripts/render/images.mjs --template ${templateId} --slots /dev/stdin --out /tmp/asset <<'JSON' … JSON（Playwright が無ければ省く）`,
  );
}
