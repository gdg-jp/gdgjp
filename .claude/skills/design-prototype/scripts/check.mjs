#!/usr/bin/env node
// Builds a development variant of the prototype and verifies it in headless Chromium: renders the
// board and every frame, plays every flow in the App, and reports console errors, layout problems
// and design-rule warnings as it goes. Screenshots are saved for review.
//
//   node check.mjs <dir> [--dark] [--fonts] [--no-typecheck]
//
// Screenshots go to <dir>/shots/. Exits with 1 when anything logs an error or a flow step fails.
// To look by hand, open <dir>/.build/check/check.html#solo=<frame id>&theme=dark, or #view=play.

import { mkdir, realpath, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { buildPrototype, dsDir, parseArgs } from "./build.mjs";

const options = parseArgs(process.argv.slice(2));
let result;
try {
  const dir = await realpath(resolve(options.dir));
  console.log("Building…");
  result = await buildPrototype({
    ...options,
    dir,
    dev: true,
    out: join(dir, ".build/check/check.html"),
    quiet: true,
  });
} catch (error) {
  console.error(error.expected ? error.message : error);
  process.exit(1);
}

const { dir, out } = result;
const shotsDir = join(dir, "shots");
await rm(shotsDir, { recursive: true, force: true });
await mkdir(shotsDir, { recursive: true });
const url = pathToFileURL(out).href;
const startedAll = Date.now();

let chromium;
try {
  ({ chromium } = createRequire(join(dsDir, "package.json"))("@playwright/test"));
} catch {
  console.error("Playwright is missing. Run: pnpm install");
  process.exit(1);
}
let browser;
try {
  browser = await chromium.launch();
} catch (error) {
  const hint = "Run: pnpm --filter @gdgjp/design-system exec playwright install chromium";
  console.error(`${error.message.split("\n")[0]}\n${hint}`);
  process.exit(1);
}

const viewports = { desktop: { width: 1280, height: 800 }, mobile: { width: 390, height: 844 } };
const STEP_TIMEOUT = 15_000;
// React logs through printf-style format strings; drop the leading "%o %s" placeholders.
const clip = (raw) => {
  const text = raw.replace(/^(%[a-zA-Z]\s*)+/, "");
  return text.length > 600 ? `${text.slice(0, 600)}…` : text;
};
let errorCount = 0;
let warningCount = 0;

function withTimeout(promise, ms, what) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out after ${ms / 1000}s (${what})`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function newIssues() {
  return { errors: new Set(), warnings: new Set(), notes: new Set() };
}

/** Prints one result as soon as it is known, so a slow or stuck page is visible while running. */
function report(label, file, issues, started) {
  const mark = issues.errors.size ? "✗" : issues.warnings.size ? "!" : "✓";
  errorCount += issues.errors.size;
  warningCount += issues.warnings.size;
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  console.log(`${mark} ${label}  (${seconds}s)\n    ${file}`);
  const indent = (text) => text.replaceAll("\n", "\n      ");
  for (const error of issues.errors) console.log(`    error: ${indent(error)}`);
  for (const warning of issues.warnings) console.log(`    warning: ${indent(warning)}`);
  for (const note of issues.notes) console.log(`    note: ${indent(note)}`);
}

/** Opens a page, recording what it logs. Retries once, since a loaded machine can stall a page. */
async function open(hash, viewport, issues) {
  for (let attempt = 1; ; attempt++) {
    const page = await browser.newPage({ viewport });
    page.on("pageerror", (error) => issues.errors.add(clip(error.stack || error.message)));
    page.on("console", (message) => {
      if (message.type() === "error") issues.errors.add(clip(message.text()));
      if (message.type() === "warning") issues.warnings.add(clip(message.text()));
    });
    try {
      await page.goto(`${url}#${hash}`, { timeout: 30_000 });
      await withTimeout(
        page.evaluate(() => document.fonts.ready.then(() => true)),
        10_000,
        "fonts",
      );
      // Dialogs and sheets animate in over 250-280ms.
      await page.waitForTimeout(500);
      return page;
    } catch (error) {
      await page.close().catch(() => {});
      if (attempt === 2) throw error;
    }
  }
}

/** Layout facts the screenshots alone do not make obvious. Runs in the page. */
function inspect() {
  const shown = (element) => {
    const box = element.getBoundingClientRect();
    return (
      box.width > 0 &&
      box.height > 0 &&
      getComputedStyle(element).visibility !== "hidden" &&
      !element.closest("[aria-hidden=true], [hidden], [inert]")
    );
  };
  const primaries = [...document.querySelectorAll(".gdg-button-primary")]
    .filter(shown)
    .map((element) => (element.textContent || element.getAttribute("aria-label") || "").trim());
  const dialogs = [...document.querySelectorAll("[role=dialog], [role=alertdialog]")].filter(shown);
  const dialog = dialogs.length > 0;

  // A primary action inside an open dialog must be reachable without scrolling.
  const hiddenActions = [];
  for (const button of dialogs.flatMap((item) => [
    ...item.querySelectorAll(".gdg-button-primary, .gdg-button-danger"),
  ])) {
    let top = 0;
    let bottom = innerHeight;
    for (let parent = button.parentElement; parent; parent = parent.parentElement) {
      if (/(auto|scroll)/.test(getComputedStyle(parent).overflowY)) {
        const box = parent.getBoundingClientRect();
        top = Math.max(top, box.top);
        bottom = Math.min(bottom, box.bottom);
      }
    }
    const box = button.getBoundingClientRect();
    if (box.bottom > bottom + 1 || box.top < top - 1) hiddenActions.push(button.textContent.trim());
  }

  // Short headings that wrap read badly in Japanese (「受付でき／ません」). Longer ones are
  // usually data such as page titles, where wrapping is fine.
  const wrapped = [];
  for (const heading of document.querySelectorAll(
    "h1, h2, h3, h4, .gdg-alert strong, [role=dialog] h2, [role=alertdialog] h2",
  )) {
    const text = heading.textContent.trim();
    if (!shown(heading) || !text || text.length > 16) continue;
    const style = getComputedStyle(heading);
    const line = Number.parseFloat(style.lineHeight) || Number.parseFloat(style.fontSize) * 1.3;
    const lines = Math.round(heading.getBoundingClientRect().height / line);
    if (lines >= 2) wrapped.push(`${text}（${lines} 行）`);
  }

  const wrappedTabs = [...document.querySelectorAll(".gdg-tabs-list")].filter(
    (list) =>
      shown(list) &&
      new Set([...list.children].map((tab) => Math.round(tab.getBoundingClientRect().top))).size >
        1,
  ).length;

  const root = document.documentElement;
  let below = root.scrollHeight - innerHeight;
  // App shells often scroll their main region instead of the document.
  for (const element of document.querySelectorAll("body *")) {
    const overflow = getComputedStyle(element).overflowY;
    if (
      (overflow === "auto" || overflow === "scroll") &&
      element.clientHeight > innerHeight / 2 &&
      element.scrollHeight > element.clientHeight + 1
    )
      below = Math.max(below, element.scrollHeight - element.clientHeight);
  }
  return {
    primaries,
    dialog,
    hiddenActions,
    wrapped,
    wrappedTabs,
    below,
    wide: root.scrollWidth - innerWidth,
  };
}

async function checkLayout(page, issues, { height } = {}) {
  const facts = await withTimeout(page.evaluate(inspect), STEP_TIMEOUT, "inspect");
  if (facts.wide > 1) issues.warnings.add(`横にはみ出しています（${facts.wide}px）。固定幅を外す`);
  if (facts.primaries.length > 1)
    issues.warnings.add(
      `primary ボタンが ${facts.primaries.length} 個見えています（${facts.primaries.join("、")}）。1 つにする`,
    );
  for (const action of facts.hiddenActions)
    issues.warnings.add(
      `ダイアログの「${action}」がスクロールしないと見えません。ボタンの行をスクロール領域の外に出す`,
    );
  if (facts.wrapped.length)
    issues.warnings.add(
      `短い見出しが折り返しています: ${facts.wrapped.join("、")}。1 行に収まる文言にする`,
    );
  if (facts.wrappedTabs) issues.warnings.add("タブが折り返しています。タブの文言を短くする");
  // A long list running past the frame is expected; a small cut-off usually hides a footer.
  if (height && facts.below > 8 && facts.below < height && !facts.dialog)
    issues.notes.add(
      `内容がフレームの下に ${facts.below}px 続いています。見せたいなら height: ${height + facts.below}`,
    );
}

const CLICK_ROLES = [
  "button",
  "link",
  "tab",
  "menuitem",
  "menuitemradio",
  "menuitemcheckbox",
  "option",
  "checkbox",
  "radio",
  "switch",
  "combobox",
  "treeitem",
  "row",
];

async function firstVisible(candidates) {
  return (await firstVisibleMatch(candidates))?.locator ?? null;
}

/** The first candidate with visible matches, how many it matched, and whether it was exact. */
async function firstVisibleMatch(candidates) {
  for (const [index, candidate] of candidates.entries()) {
    const locator = candidate.filter({ visible: true });
    const count = await locator.count();
    if (count) return { locator: locator.first(), count, index };
  }
  return null;
}

function anyRole(page, name, exact) {
  return CLICK_ROLES.map((role) => page.getByRole(role, { name, exact })).reduce((a, b) => a.or(b));
}

async function visibleControls(page) {
  const names = await page
    .getByRole("button")
    .or(page.getByRole("link"))
    .or(page.getByRole("tab"))
    .filter({ visible: true })
    .evaluateAll((elements) =>
      elements.map((element) =>
        (element.getAttribute("aria-label") || element.textContent || "").trim(),
      ),
    );
  return [...new Set(names.filter(Boolean))].slice(0, 20).join("、");
}

function describeStep(step) {
  if ("click" in step) return `「${step.click}」を押す`;
  if ("fill" in step) return `「${step.fill}」に入力する`;
  if ("select" in step) return `「${step.select}」で「${step.option}」を選ぶ`;
  if ("press" in step) return `${step.press} キー`;
  if ("expect" in step) return `「${step.expect}」が表示される`;
  if ("control" in step) return `${step.control} を ${step.value} にする`;
  return JSON.stringify(step);
}

async function runStep(page, step, controls, issues) {
  if ("click" in step) {
    const match = await firstVisibleMatch([
      anyRole(page, step.click, true),
      anyRole(page, step.click, false),
      page.getByText(step.click, { exact: true }),
    ]);
    if (!match) throw new Error(`見つかりません。表示中: ${await visibleControls(page)}`);
    if (match.count > 1) {
      const name = await match.locator.evaluate((element) =>
        (element.getAttribute("aria-label") || element.textContent || "").trim().slice(0, 40),
      );
      issues.warnings.add(
        `「${step.click}」に${match.index === 1 ? "部分一致" : "一致"}する要素が ${match.count} 個あり、「${name}」を押しました。名前で一意に決まるようにする`,
      );
    }
    await match.locator.click({ timeout: 5_000 });
  } else if ("fill" in step) {
    const field = await firstVisible([
      page.getByLabel(step.fill, { exact: true }),
      page.getByPlaceholder(step.fill, { exact: true }),
      page.getByLabel(step.fill),
    ]);
    if (!field) throw new Error("その名前の入力欄が見つかりません");
    await field.fill(step.value, { timeout: 5_000 });
  } else if ("select" in step) {
    const field = await firstVisible([
      page.getByRole("combobox", { name: step.select, exact: true }),
      page.getByLabel(step.select, { exact: true }),
      page.getByRole("combobox", { name: step.select }),
    ]);
    if (!field) throw new Error("その名前の選択欄が見つかりません");
    if ((await field.evaluate((element) => element.tagName)) === "SELECT") {
      await field.selectOption({ label: step.option }, { timeout: 5_000 });
    } else {
      await field.click({ timeout: 5_000 });
      const option = await firstVisible([
        page.getByRole("option", { name: step.option, exact: true }),
        page.getByRole("option", { name: step.option }),
      ]);
      if (!option) throw new Error(`選択肢「${step.option}」が見つかりません`);
      await option.click({ timeout: 5_000 });
    }
  } else if ("press" in step) {
    await page.keyboard.press(step.press);
  } else if ("expect" in step) {
    await page
      .getByText(step.expect)
      .filter({ visible: true })
      .first()
      .waitFor({ state: "visible", timeout: 5_000 })
      .catch(() => {
        throw new Error("表示されていません");
      });
  } else if ("control" in step) {
    controls[step.control] = step.value;
    await page.evaluate(
      (values) => window.postMessage({ type: "proto:controls", controls: values }, "*"),
      { ...controls },
    );
  } else {
    throw new Error(`未知のステップです: ${JSON.stringify(step)}`);
  }
}

async function shoot(page, file, options) {
  await withTimeout(page.screenshot({ path: file, ...options }), 30_000, "screenshot");
}

// 1. The board, which also tells us the frames, controls and flows.
let meta = null;
{
  const issues = newIssues();
  const started = Date.now();
  const file = join(shotsDir, "_board.png");
  try {
    const page = await open("view=board&eager", { width: 1440, height: 900 }, issues);
    meta = await page
      .waitForFunction(
        () => {
          const proto = window.__proto;
          if (!proto) return null;
          const done = proto.frames.every(
            (frame) => proto.status[frame.id]?.ready || proto.status[frame.id]?.errors.length,
          );
          return done ? proto : null;
        },
        null,
        { timeout: 60_000 },
      )
      .then((handle) => handle.jsonValue())
      .catch(() => page.evaluate(() => window.__proto ?? null));
    await shoot(page, file);
    await page.close();
    if (!meta) issues.errors.add("The viewer did not start. Open check.html to see the error.");
  } catch (error) {
    issues.errors.add(`画面一覧を開けません: ${error.message}`);
  }
  report("画面一覧 (board)", relative(dir, file), issues, started);
  if (meta)
    console.log(
      `  ${meta.frames.length} frames, ${meta.flows.length} flows. Usually under a minute in total.`,
    );
}

// 2. Every frame at its own size, exactly as the board crops it.
const themes = options.dark ? ["light", "dark"] : ["light"];
for (const frame of meta?.frames ?? []) {
  for (const theme of themes) {
    const issues = newIssues();
    const started = Date.now();
    const suffix = theme === "dark" ? ".dark" : "";
    const file = join(shotsDir, `${frame.id}${suffix}.png`);
    try {
      const page = await open(
        `solo=${encodeURIComponent(frame.id)}&theme=${theme}`,
        { width: frame.width, height: frame.height },
        issues,
      );
      await shoot(page, file);
      if (theme === "light") await checkLayout(page, issues, { height: frame.height });
      await page.close();
    } catch (error) {
      issues.errors.add(`描画できません: ${error.message}`);
    }
    const label = `${frame.id}  ${frame.screen} / ${frame.state}${theme === "dark" ? " (dark)" : ""}`;
    report(label, relative(dir, file), issues, started);
  }
}

// 3. Every flow, step by step, in the interactive App.
const initial = Object.fromEntries(
  (meta?.controls ?? []).map((control) => [control.id, control.options[0]?.value ?? ""]),
);
for (const [index, flow] of (meta?.flows ?? []).entries()) {
  const issues = newIssues();
  const started = Date.now();
  const number = index + 1;
  const controls = { ...initial, ...flow.controls };
  const viewport = viewports[flow.viewport ?? meta.viewport] ?? viewports.desktop;
  try {
    const hash = `solo=app&theme=light&controls=${encodeURIComponent(JSON.stringify(controls))}`;
    const page = await open(hash, viewport, issues);
    for (const [stepIndex, step] of flow.steps.entries()) {
      try {
        await withTimeout(runStep(page, step, controls, issues), STEP_TIMEOUT, describeStep(step));
      } catch (error) {
        issues.errors.add(`step ${stepIndex + 1} ${describeStep(step)}: ${error.message}`);
        await shoot(page, join(shotsDir, `flow-${number}-${stepIndex + 1}-failed.png`));
        break;
      }
      await page.waitForTimeout(350);
      await shoot(page, join(shotsDir, `flow-${number}-${stepIndex + 1}.png`));
      await checkLayout(page, issues);
    }
    await page.close();
  } catch (error) {
    issues.errors.add(`App を開けません: ${error.message}`);
  }
  report(
    `flow ${number}  ${flow.name} (${flow.steps.length} steps)`,
    `shots/flow-${number}-*.png`,
    issues,
    started,
  );
}
if (meta && !meta.flows.length)
  console.log(
    "! flows がありません\n    note: 主要フローを definePrototype の flows に書くと、check が App を操作して確かめます",
  );

// 4. The App's first screen at both widths.
for (const [name, viewport] of Object.entries(viewports)) {
  const issues = newIssues();
  const started = Date.now();
  const file = join(shotsDir, `app.${name}.png`);
  try {
    const page = await open("solo=app&theme=light", viewport, issues);
    await shoot(page, file);
    await checkLayout(page, issues);
    await page.close();
  } catch (error) {
    issues.errors.add(`App を開けません: ${error.message}`);
  }
  report(`app  操作 (${name})`, relative(dir, file), issues, started);
}
await browser.close();

const total = `${Math.round((Date.now() - startedAll) / 1000)}s`;
console.log(
  errorCount
    ? `\n${errorCount} errors, ${warningCount} warnings in ${total}. Fix the errors, then run check again.`
    : `\nNo errors, ${warningCount} warnings in ${total}. Screenshots: ${shotsDir}`,
);
process.exit(errorCount ? 1 : 0);
