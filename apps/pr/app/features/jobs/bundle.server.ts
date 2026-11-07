import { analyzeFiles } from "~/features/analyze/analyze.server";
import { assistBundle } from "~/features/assistant/bundle.server";
import type { Brief } from "~/features/briefs/brief";
import { briefVersion, latestBrief } from "~/features/briefs/brief.repository.server";
import type { Campaign } from "~/features/campaigns/campaign";
import { getDraftById, latestVersion, listDrafts } from "~/features/drafts/draft.repository.server";
import { retroFiles } from "~/features/learning/retro.server";
import { adoptedPlan, getPlanById, listPlans } from "~/features/plans/plan.repository.server";
import {
  checkScripts,
  exampleOutputs,
  outputSchemas,
  playbookFile,
  skillReads,
  skills,
} from "~/features/playbook/guides.server";
import { playbook, scopeForKind } from "~/features/playbook/playbook";
import { jstDate, jstTime } from "~/features/schedule/calendar";
import { getItem, listItems } from "~/features/schedule/item.repository.server";
import { assetFiles, pageFiles } from "./page-bundle.server";
import { JOB_TIMEOUT_SECONDS, type Job } from "./shared";
import { SKILL_FOR_KIND } from "./skill-kinds";

export const MAX_BUNDLE_BYTES = 2 * 1024 * 1024;

/** Which Skill a job runs. A fix runs the Skill that made the draft. */
export function skillFor(job: Job): { skill: string; kind: string } {
  const payload = job.payload as { kind?: string; channel?: string };
  switch (job.type) {
    case "plan":
      return { skill: "pr-plan", kind: "plan" };
    case "copy":
      return { skill: "pr-copy", kind: "copy" };
    case "post":
      return { skill: "pr-x-post", kind: payload.channel === "ig" ? "ig_post" : "x_post" };
    case "asset":
      return { skill: "pr-asset", kind: "asset_spec" };
    case "analyze":
      return { skill: "pr-analyze", kind: "plan" };
    case "retro":
      return { skill: "pr-retro", kind: "plan" };
    case "page":
      return payload.kind === "connpass_mail"
        ? { skill: "pr-connpass-mail", kind: "connpass_mail" }
        : { skill: "pr-connpass-page", kind: "connpass_page" };
    case "assist":
      return { skill: "pr-assist", kind: "assist" };
    case "fix":
      return {
        skill: SKILL_FOR_KIND[payload.kind ?? ""] ?? "pr-playbook",
        kind: payload.kind ?? "",
      };
    default:
      return { skill: `pr-${job.type}`, kind: job.type };
  }
}

const iso = (epoch: number) => `${jstDate(epoch)}T${jstTime(epoch)}:00+09:00`;
const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;

export type Bundle = {
  files: Record<string, string>;
  /** Base64 files (images) the runner writes beside `files`; `images` are attached to the prompt. */
  binaryFiles?: Record<string, string>;
  images?: string[];
  /** The agent may write files in the job directory (design drafts); default read-only. */
  workspaceWrite?: boolean;
  /** The runner starts the render broker (scripts/render/broker.mjs) beside the agent. */
  render?: boolean;
  prompt: string;
  skill: string;
  kind: string;
  timeoutSeconds: number;
};

/** Everything the runner needs for one job, as files. The runner holds no repository. */
export async function buildBundle(
  db: D1Database,
  job: Job,
  campaign: Campaign,
  env?: Env,
): Promise<Bundle> {
  const { skill, kind } = skillFor(job);
  const files: Record<string, string> = {};
  const skillMd = skills[skill];
  const schema = outputSchemas[skill];
  if (!skillMd || !schema) throw new Error(`skill ${skill} is not bundled`);
  files[`skills/${skill}/SKILL.md`] = skillMd;
  files[`skills/${skill}/references/output.schema.json`] = json(schema);
  if (exampleOutputs[skill])
    files[`skills/${skill}/references/example-output.json`] = exampleOutputs[skill] as string;
  if (job.type === "assist") {
    if (!env) throw new Error("assist bundles need the Worker env");
    const task: string[] = [];
    const extra = await assistBundle(env, job, campaign, files, task);
    files["JOB.md"] = [
      `# ジョブ ${job.id}（assist）`,
      "",
      `キャンペーン: ${campaign.name}`,
      "",
      ...task,
      "",
      "## 進め方",
      `- skills/${skill}/SKILL.md の手順に従う。ファイルは書けない。`,
      "- 最後のメッセージは出力スキーマに合う JSON だけ。",
      "",
    ].join("\n");
    return {
      files,
      ...extra,
      prompt: `You are the event assistant (${skill} Skill) for GDG Japan. Read JOB.md, then skills/${skill}/SKILL.md, look at every image listed there, and do what they say. Reply with the JSON object only.`,
      skill,
      kind,
      timeoutSeconds: JOB_TIMEOUT_SECONDS.assist,
    };
  }
  const scope = scopeForKind(kind);
  files["skills/pr-playbook/rules.json"] = json({
    rules: playbook.rules.filter((r) => r.scope.includes(scope)),
  });
  files["skills/pr-playbook/constants.json"] = json(playbook.constants);
  for (const path of skillReads(skill)) {
    const text = playbookFile(path);
    if (text) files[`skills/pr-playbook/${path}`] = text;
  }
  for (const [path, text] of Object.entries(checkScripts)) files[`skills/${path}`] = text;

  const payload = job.payload as Record<string, unknown>;
  const brief = await briefFor(
    db,
    campaign.id,
    typeof payload.briefVersion === "number" ? payload.briefVersion : null,
  );
  if (!brief) throw new Error("campaign has no brief");
  files["BRIEF.json"] = json(brief);
  const task: string[] = [];
  let extra: Partial<Bundle> = {};

  if (job.type === "plan") {
    const previous = (await listPlans(db, campaign.id))[0];
    if (previous) files["PLAN_PREVIOUS.json"] = json(previous.body);
    task.push("brief（BRIEF.json）からこのイベントの PR 計画を作る。");
    if (previous)
      task.push(
        `前の計画（版 ${previous.version}）が PLAN_PREVIOUS.json にある。良いところは残して直す。`,
      );
  } else if (job.type === "copy") {
    const plan = await adoptedPlan(db, campaign.id);
    if (plan) files["PLAN.json"] = json(plan.body);
    task.push(`タイトルとメインコピーの候補を ${Number(payload.count ?? 5)} 個作る。`);
  } else if (job.type === "post") {
    const ids = (payload.scheduleItemIds as number[]) ?? [];
    const all = await listItems(db, campaign.id);
    const targets = all.filter((i) => ids.includes(i.id));
    files["SCHEDULE.json"] = json({
      targets: targets.map((i) => ({
        scheduleItemId: i.id,
        kind: i.kind,
        title: i.title,
        scheduledAt: iso(i.dueAt),
        speakerId: i.speakerId,
        sessionId: i.sessionId,
        purpose: i.purpose,
        note: i.note,
      })),
      context: all
        .filter((i) => !ids.includes(i.id) && i.derivedFromItemId === null)
        .slice(0, 40)
        .map((i) => ({ kind: i.kind, title: i.title, at: iso(i.dueAt), status: i.status })),
    });
    const copy = await approvedCopy(db, campaign.id);
    if (copy) files["COPY.json"] = json(copy);
    task.push(
      `SCHEDULE.json の targets の ${targets.length} 件それぞれに投稿を 1 本ずつ書く（channel: ${payload.channel === "ig" ? "ig" : "x"}）。`,
      "各投稿の scheduleItemId に targets の scheduleItemId をそのまま入れ、scheduledAt も targets の値を使う。",
    );
    if (copy) task.push("COPY.json の採用コピーに沿って書く。");
  } else if (job.type === "retro" && env) {
    await retroFiles(env, campaign, files, task);
  } else if (job.type === "analyze" && env) {
    await analyzeFiles(env, campaign, files, task);
  } else if (job.type === "asset") {
    if (!env) throw new Error("asset bundles need the Worker env");
    extra = await assetFiles(env, campaign, brief, payload, files, task);
  } else if (job.type === "page") {
    await pageFiles(db, campaign, payload, files, task);
  } else if (job.type === "fix") {
    const target = payload.target as { table: string; id: number; version: number };
    if (target.table === "plans") {
      const plan = await getPlanById(db, target.id);
      files["DRAFT_PREVIOUS.json"] = json(plan?.body ?? {});
    } else {
      const draft = await getDraftById(db, target.id);
      const version = draft ? await latestVersion(db, draft.id) : null;
      files["DRAFT_PREVIOUS.json"] = json(version?.content ?? {});
      if (draft?.scheduleItemId) {
        const item = await getItem(db, campaign.id, draft.scheduleItemId);
        if (item)
          files["SCHEDULE.json"] = json({
            targets: [
              {
                scheduleItemId: item.id,
                kind: item.kind,
                title: item.title,
                scheduledAt: iso(item.dueAt),
              },
            ],
          });
      }
    }
    files["CHECKS.json"] = json(payload.failures);
    task.push(
      "DRAFT_PREVIOUS.json は Playbook の検査で MUST が落ちた下書き。CHECKS.json の失敗だけを直し、ほかは変えずに、出力スキーマの形で全体を返す。",
    );
  }
  if (typeof payload.instructions === "string" && payload.instructions.trim()) {
    task.push("", "## 人からの追加の指示", payload.instructions.trim());
  }
  files["JOB.md"] = [
    `# ジョブ ${job.id}（${job.type}）`,
    "",
    `キャンペーン: ${campaign.name}`,
    "",
    ...task,
    "",
    "## 進め方",
    `- skills/${skill}/SKILL.md の手順に従う。Playbook は skills/pr-playbook にある（このジョブに要る部分だけ）。`,
    ...(extra.workspaceWrite
      ? [
          "- このディレクトリにはファイルを書ける（draft.html、out/）。描画器は GDG_RENDER_BROKER の broker。",
          "- 描画した PNG は view_image で必ず見る。検査結果は out/checks.json。",
        ]
      : [
          "- ファイルは書けない。検査は標準入力で渡す:",
          `  node skills/pr-playbook/scripts/checks/run.mjs --kind ${kind} --input /dev/stdin --brief BRIEF.json --no-yomiyasu <<'JSON'`,
          "  {…下書きの JSON…}",
          "  JSON",
        ]),
    "- MUST が落ちたら直してから返す。日本語は yomiyasu の方針（不自然な比喩・コピー調・曖昧な主述を避ける）で書く。",
    "- 最後のメッセージは出力スキーマに合う JSON だけ。",
    "",
  ].join("\n");
  const prompt = extra.images?.length
    ? `You are running the ${skill} Skill for GDG Japan. Read JOB.md, then skills/${skill}/SKILL.md, look at every attached image, and do what they say. Reply with the JSON object only.`
    : `You are running the ${skill} Skill for GDG Japan. Read JOB.md, then skills/${skill}/SKILL.md, and do what they say. Reply with the JSON object only.`;
  const bytes = Object.values(files).reduce(
    (n, text) => n + new TextEncoder().encode(text).length,
    0,
  );
  if (bytes > MAX_BUNDLE_BYTES) {
    for (const path of Object.keys(files)) if (path.includes("/examples/")) delete files[path];
  }
  return { files, ...extra, prompt, skill, kind, timeoutSeconds: JOB_TIMEOUT_SECONDS[job.type] };
}

async function briefFor(
  db: D1Database,
  campaignId: number,
  version: number | null,
): Promise<Brief | null> {
  const stored = version
    ? await briefVersion(db, campaignId, version)
    : await latestBrief(db, campaignId);
  return stored?.brief ?? null;
}

/** The approved copy (first candidate) or, failing that, the newest copy draft. */
export async function approvedCopy(db: D1Database, campaignId: number): Promise<unknown | null> {
  const drafts = await listDrafts(db, campaignId);
  const copy =
    drafts.find((d) => d.kind === "copy" && d.status === "approved") ??
    drafts.find((d) => d.kind === "copy");
  if (!copy) return null;
  const version = await latestVersion(db, copy.id);
  const content = version?.content as { candidates?: unknown[] } | undefined;
  return content?.candidates?.[0] ?? null;
}
