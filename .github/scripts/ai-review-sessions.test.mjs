import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import {
  GENERATION_FILE,
  SESSION_SOURCES,
  SessionStore,
  openSession,
  restore,
  rollouts,
  sealSession,
} from "./ai-review-sessions.mjs";
import { CodexRunner, RESUMED_NOTE, codexArgs } from "./codex-review.mjs";

const SECRET = "s".repeat(40);
const ID = "01a20bc9-2930-7221-ad2c-2dfddcbc9d50";
const PATH = `sessions/2026/11/24/rollout-2026-11-24T13-21-02-${ID}.jsonl`;

async function scratch() {
  const root = await mkdtemp(join(tmpdir(), "sessions-test-"));
  return { root, home: join(root, "home"), dir: join(root, "saved") };
}

test("a sealed session opens only for its own pull request and key", () => {
  const sealed = sealSession({ v: 1, id: ID }, 7, SECRET);
  assert.deepEqual(openSession(sealed, 7, SECRET), { v: 1, id: ID });
  assert.throws(() => openSession(sealed, 8, SECRET));
  assert.throws(() => openSession(sealed, 7, "t".repeat(40)));
  const tampered = Buffer.from(sealed);
  tampered[tampered.length - 1] ^= 1;
  assert.throws(() => openSession(tampered, 7, SECRET));
  assert.ok(!sealed.includes(Buffer.from(ID)));
});

test("a stored session comes back as the same rollout in a fresh Codex home", async () => {
  const { root, home, dir } = await scratch();
  try {
    await mkdir(join(home, "sessions/2026/11/24"), { recursive: true });
    await writeFile(join(home, PATH), '{"type":"session_meta"}\n');
    const store = new SessionStore({ dir, codexHome: home, secret: SECRET, log: () => {} });
    await store.store(7, "model-a", ID);
    const fresh = join(root, "fresh");
    const restored = new SessionStore({ dir, codexHome: fresh, secret: SECRET, log: () => {} });
    assert.equal(await restored.load(7, "model-a"), ID);
    assert.equal(await readFile(join(fresh, PATH), "utf8"), '{"type":"session_meta"}\n');
    assert.deepEqual([...(await rollouts(fresh)).entries()], [[ID, PATH]]);
    assert.equal(await restored.load(7, "model-b"), null);
    assert.equal(await restored.load(8, "model-a"), null);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("an unreadable or misplaced session is dropped", async () => {
  const { root, home, dir } = await scratch();
  try {
    await mkdir(dir, { recursive: true });
    const store = new SessionStore({ dir, codexHome: home, secret: SECRET, log: () => {} });
    await writeFile(store.file(3), "garbage");
    assert.equal(await store.load(3, "m"), null);
    const outside = { v: 1, id: ID, model: "m", path: `../${PATH}`, rollout: "" };
    await writeFile(store.file(4), sealSession(outside, 4, SECRET));
    assert.equal(await store.load(4, "m"), null);
    assert.deepEqual(await readdir(dir), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("keepOnly drops closed pull requests' sessions but keeps the generation marker", async () => {
  const { root, home, dir } = await scratch();
  try {
    await mkdir(dir, { recursive: true });
    for (const name of ["pr-1.enc", "pr-2.enc", GENERATION_FILE]) {
      await writeFile(join(dir, name), "x");
    }
    await new SessionStore({ dir, codexHome: home, secret: SECRET }).keepOnly([]);
    assert.deepEqual(await readdir(dir), [GENERATION_FILE]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Codex runs with a 500k context and persists its session unless it resumes one", () => {
  const common = { model: "m", effort: "low", codexHome: "/h", schemaPath: "/s", outputPath: "/o" };
  const fresh = codexArgs({ ...common, cwd: "/w", resume: null });
  assert.deepEqual(fresh.slice(0, 1), ["exec"]);
  assert.ok(fresh.includes("model_context_window=500000"));
  assert.ok(!fresh.includes("--ephemeral"));
  assert.deepEqual(fresh.slice(-3), ["--cd", "/w", "-"]);
  const resumed = codexArgs({ ...common, cwd: "/w", resume: ID });
  assert.deepEqual(resumed.slice(0, 2), ["exec", "resume"]);
  assert.deepEqual(resumed.slice(-2), [ID, "-"]);
  assert.ok(!resumed.includes("--cd"));
});

async function fakeCodex(root, { failResume = false } = {}) {
  const bin = join(root, "bin");
  await mkdir(bin, { recursive: true });
  const script = `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const args = process.argv.slice(2);
const home = process.env.CODEX_HOME;
const prompt = fs.readFileSync(0, "utf8");
const resume = args[1] === "resume" ? args[args.length - 2] : null;
fs.appendFileSync(path.join(home, "calls.log"), JSON.stringify({ resume, prompt }) + "\\n");
if (resume && ${failResume}) process.exit(1);
const id = resume ?? "${ID.slice(0, -1)}" + String(fs.readFileSync(path.join(home, "calls.log"), "utf8").split("\\n").length - 1);
const dir = path.join(home, "sessions/2026/11/24");
fs.mkdirSync(dir, { recursive: true });
fs.appendFileSync(path.join(dir, "rollout-2026-11-24T00-00-00-" + id + ".jsonl"), JSON.stringify({ prompt }) + "\\n");
fs.writeFileSync(args[args.indexOf("--output-last-message") + 1], JSON.stringify({ id }));
`;
  await writeFile(join(bin, "codex"), script);
  await chmod(join(bin, "codex"), 0o755);
  return bin;
}

async function withRunner(options, body) {
  const { root, home, dir } = await scratch();
  const path = process.env.PATH;
  const log = console.log;
  try {
    await mkdir(home, { recursive: true });
    process.env.PATH = `${await fakeCodex(root, options)}:${path}`;
    console.log = () => {};
    const sessions = new SessionStore({ dir, codexHome: home, secret: SECRET, log: () => {} });
    const runner = (codexHome) =>
      new CodexRunner({
        codexHome,
        model: "m",
        effort: "low",
        secrets: [],
        sessions: new SessionStore({ dir, codexHome, secret: SECRET, log: () => {} }),
      });
    await body({ root, home, sessions, runner });
  } finally {
    process.env.PATH = path;
    console.log = log;
    await rm(root, { recursive: true, force: true });
  }
}

const calls = async (home) =>
  (await readFile(join(home, "calls.log"), "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));

test("later runs on the same pull request resume its session from a fresh Codex home", async () => {
  await withRunner({}, async ({ root, home, runner }) => {
    const exec = (codexHome, thread, prompt) =>
      runner(codexHome).exec({ cwd: root, prompt, schema: {}, thread });
    const first = await exec(home, 7, "review");
    const second = join(root, "second");
    await mkdir(second);
    assert.deepEqual(await exec(second, 7, "verify"), first);
    const other = await exec(second, 8, "review other");
    assert.notEqual(other.id, first.id);
    const made = await calls(second);
    assert.deepEqual(made[0], { resume: first.id, prompt: `${RESUMED_NOTE}verify` });
    assert.deepEqual(made[1], { resume: null, prompt: "review other" });
    const rollout = await readFile(join(second, (await rollouts(second)).get(first.id)), "utf8");
    assert.equal(rollout.trim().split("\n").length, 2);
  });
});

test("a session that cannot be resumed is replaced by a new one", async () => {
  await withRunner({ failResume: true }, async ({ root, home, runner, sessions }) => {
    const first = await runner(home).exec({ cwd: root, prompt: "a", schema: {}, thread: 7 });
    const second = await runner(home).exec({ cwd: root, prompt: "b", schema: {}, thread: 7 });
    assert.notEqual(second.id, first.id);
    assert.deepEqual(
      (await calls(home)).map((call) => call.resume),
      [null, first.id, null],
    );
    assert.equal(await sessions.load(7, "m"), second.id);
  });
});

test("restore marks an empty generation and reads only ai-review runs on main", async () => {
  const { root, dir } = await scratch();
  try {
    const asked = [];
    const github = {
      artifacts: async (name, trust) => {
        asked.push([name, trust]);
        return [];
      },
    };
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "pr-9.enc"), "stale");
    await restore({ github, dir });
    assert.deepEqual(asked, [["codex-sessions", SESSION_SOURCES]]);
    assert.deepEqual(SESSION_SOURCES.workflows, [".github/workflows/ai-review.yml"]);
    assert.deepEqual(await readdir(dir), [GENERATION_FILE]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("restore unpacks the newest trusted bundle", async () => {
  const { root, dir } = await scratch();
  try {
    const source = join(root, "source");
    await mkdir(source, { recursive: true });
    await writeFile(join(source, "pr-3.enc"), "sealed");
    await writeFile(join(source, GENERATION_FILE), "{}");
    await promisify(execFile)("zip", [
      "-q",
      "-j",
      join(root, "a.zip"),
      join(source, "pr-3.enc"),
      join(source, GENERATION_FILE),
    ]);
    const zip = await readFile(join(root, "a.zip"));
    const github = {
      artifacts: async () => [{ id: 5, created_at: "2026-11-24T00:00:00Z" }],
      download: async () => zip,
    };
    const log = console.log;
    console.log = () => {};
    await restore({ github, dir }).finally(() => {
      console.log = log;
    });
    assert.equal(await readFile(join(dir, "pr-3.enc"), "utf8"), "sealed");
    assert.deepEqual(JSON.parse(await readFile(join(dir, GENERATION_FILE), "utf8")), { from: 5 });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a review result survives a failure to save its session", async () => {
  await withRunner({}, async ({ root, home }) => {
    const runner = new CodexRunner({
      codexHome: home,
      model: "m",
      effort: "low",
      secrets: [],
      sessions: { load: async () => null, store: async () => Promise.reject(new Error("ENOSPC")) },
    });
    const result = await runner.exec({ cwd: root, prompt: "a", schema: {}, thread: 7 });
    assert.ok(result.id);
  });
});
