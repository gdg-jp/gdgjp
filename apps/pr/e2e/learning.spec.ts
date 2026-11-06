import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type APIRequestContext, expect, test } from "@playwright/test";

// The learning loop (Stage 08): edits recorded mechanically, the retro's proposals decided by a
// person, exported, and written back with feedback.mjs.
const skills = new URL("../../../skills/", import.meta.url);
const brief = readFileSync(
  new URL("pr-playbook/examples/briefs/devfest-kansai-2026.json", skills),
  "utf8",
);
const copyOutput = JSON.parse(
  readFileSync(new URL("pr-copy/references/example-output.json", skills), "utf8"),
);
const retroOutput = JSON.parse(
  readFileSync(new URL("pr-retro/references/example-output.json", skills), "utf8"),
);
const runnerToken = () =>
  /^RUNNER_TOKEN="?([^"\n]+)"?/m.exec(
    readFileSync(new URL("../.dev.vars", import.meta.url), "utf8"),
  )?.[1] ?? "";
const headers = () => ({ authorization: `Bearer ${runnerToken()}`, "x-runner-host": "e2e-runner" });

/** Lease this campaign's next job of a type (jobs left queued by earlier runs are failed and skipped). */
async function runJob(request: APIRequestContext, type: string, output: unknown, campaign: string) {
  for (let i = 0; i < 20; i++) {
    const next = await request.get(`/api/runner/jobs/next?types=${type}&wait=0`, {
      headers: headers(),
    });
    expect(next.status()).toBe(200);
    const job = await next.json();
    const bundle = await request.get(`/api/runner/jobs/${job.id}/bundle`, { headers: headers() });
    const files = (await bundle.json()).files as Record<string, string>;
    const url = `/api/runner/jobs/${job.id}/result`;
    if (!files["JOB.md"]?.includes(campaign)) {
      await request.post(url, {
        headers: headers(),
        data: { status: "failed", error: "e2e: another campaign" },
      });
      continue;
    }
    const result = { output, checks: { yomiyasu: { status: "pass" } } };
    await request.post(url, { headers: headers(), data: { status: "succeeded", result } });
    return files;
  }
  throw new Error(`no ${type} job for ${campaign}`);
}

test("edits feed the retro; accepted proposals are exported and written back", async ({
  page,
  request,
}) => {
  test.setTimeout(90_000);
  const slug = `e2e-retro-${Date.now()}`;
  await page.goto("/dev/login?as=lead&chapter=1:gdg-kwansai:organizer&return_to=/");
  await page.getByRole("button", { name: "キャンペーンを作成" }).first().click();
  await page.getByLabel("イベント名").fill(`E2E ${slug}`);
  await page.getByRole("textbox", { name: "URL", exact: true }).fill(slug);
  await page.getByRole("button", { name: "作成", exact: true }).click();
  await page.getByLabel("JSON で読み込む").fill(brief);
  await page.getByRole("button", { name: "JSON を読み込む" }).click();
  await expect(page.getByText("版 1 を保存しました")).toBeVisible();

  // A person edits the runner's copy: the change is recorded mechanically.
  await page.goto(`/c/${slug}/plan`);
  await page.getByRole("button", { name: "コピーを作る" }).click();
  await expect(page.getByText("コピーのジョブを積みました")).toBeVisible();
  await runJob(request, "copy", copyOutput, `E2E ${slug}`);
  await page.goto(`/c/${slug}/drafts`);
  await page.getByRole("link", { name: "タイトルとメインコピー" }).click();
  const edited = structuredClone(copyOutput);
  edited.candidates[0].mainCopy = "人が直したメインコピー";
  await page.getByLabel("JSON").fill(JSON.stringify(edited));
  await page.getByRole("button", { name: "新しい版として保存" }).click();
  await expect(page.getByText("版 2 を保存しました")).toBeVisible();

  // KPT notes, then the retro.
  await page.goto(`/c/${slug}/settings`);
  await page
    .getByLabel("振り返りメモ（KPT）")
    .fill("Keep: Instagram 広告\nProblem: 当日実況を 1 人で回した\nTry: 前日に全件予約");
  await page.getByRole("button", { name: "振り返る" }).click();
  await expect(page.getByText("振り返りのジョブを積みました")).toBeVisible();
  const files = await runJob(request, "retro", retroOutput, `E2E ${slug}`);
  const edits = JSON.parse(files["EDITS.json"] ?? "{}");
  expect(edits.groups.some((g: { key: string }) => g.key === "copy /candidates/*/mainCopy")).toBe(
    true,
  );
  expect(files["RETRO_NOTES.md"]).toContain("前日に全件予約");
  expect(Object.keys(files)).toEqual(
    expect.arrayContaining(["skills/pr-playbook/decisions.md", "skills/pr-retro/SKILL.md"]),
  );

  await page.goto(`/c/${slug}/drafts`);
  await page.getByRole("link", { name: "振り返り" }).click();
  await expect(page.getByLabel("Wiki に貼る更新")).toContainText("大阪大学");

  // A person decides; the accepted constant is exported and written back into a Playbook copy.
  await page.goto("/playbook/proposals?status=proposed");
  await page.getByRole("link", { name: "折りたたみ位置の観察値" }).first().click();
  await page.getByLabel("理由").fill("DevFest 2026 で観察した");
  await page.getByRole("button", { name: "採用" }).click();
  await expect(page.getByText("採用しました")).toBeVisible();

  const exported = await page.request.get("/playbook/proposals/export");
  expect(exported.headers()["content-disposition"]).toContain("proposals-");
  const bundle = await exported.json();
  expect(
    bundle.proposals.some(
      (p: { target: string }) => p.target === "constants.json#/x/foldThreshold",
    ),
  ).toBe(true);

  const dir = mkdtempSync(join(tmpdir(), "pr-playbook-e2e-"));
  for (const f of ["rules.json", "constants.json"])
    cpSync(new URL(`pr-playbook/${f}`, skills), join(dir, f));
  writeFileSync(join(dir, "bundle.json"), JSON.stringify(bundle));
  const feedback = await import(new URL("pr-playbook/scripts/feedback.mjs", skills).href);
  const imported = feedback.importBundle(join(dir, "bundle.json"), dir);
  const id = bundle.proposals.find(
    (p: { target: string }) => p.target === "constants.json#/x/foldThreshold",
  ).id;
  expect(imported.written).toContain(id);
  expect(feedback.apply(id, dir).written).toBe(true);
  expect(
    JSON.parse(readFileSync(join(dir, "constants.json"), "utf8")).x.foldThreshold,
  ).toMatchObject({ weighted: 280, provisional: false });

  // A Tips from a person goes into the same list.
  await page.goto("/playbook/proposals");
  await page.getByLabel("Tips を追加").fill(`告知の 1 行目は日時（${slug}）`);
  await page.getByRole("button", { name: "提案に足す" }).click();
  await expect(page.getByText("Tips を提案に足しました")).toBeVisible();
  await expect(page.getByRole("link", { name: `告知の 1 行目は日時（${slug}）` })).toBeVisible();
});
