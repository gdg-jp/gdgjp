import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";

export const APP_IMAGE =
  "mcr.microsoft.com/playwright:v1.59.1-noble@sha256:b0ab6f3cb99aa7803adbc14d9027ec1785fc6e433b97e134e0f8fe61683b6b53";
export const BROWSER_IMAGE =
  "mcr.microsoft.com/playwright/mcp:v0.0.85@sha256:8ca417ff2a3660b770d7dd4a293bd179d0f3c29d0d5fb5bc43d3be617b1566a2";
export const PREVIEW_APPS = [
  "accounts",
  "tinyurl",
  "wiki",
  "img",
  "scheduler",
  "sns",
  "pay",
  "ost",
  "roster",
  "mc",
  "screen",
  "deck",
  "roulette",
  "pr",
  "meet",
];
export const SUBMODULES = [
  { path: "packages/design-system", url: "https://github.com/gdg-jp/design-system.git" },
  { path: "skills", url: "https://github.com/gdg-jp/skills.git" },
];
export const DISABLED_TOOLS = ["browser_run_code_unsafe", "browser_file_upload"];
const SHARED = "/preview";
const MAX_OUTPUT = 1024 * 1024;
const MAX_READY = 64 * 1024;
export const PNPM = /^pnpm@(\d+\.\d+\.\d+)$/.exec(
  JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")).packageManager,
)?.[1];
const PNPM_FLAGS = "--config.manage-package-manager-versions=false --reporter=silent";
const READY_TIMEOUT_MS = 25 * 60 * 1000;

export function selectPreviewApp(files) {
  const counts = new Map();
  for (const file of files) {
    const match = /^apps\/([^/]+)\//.exec(file);
    if (match && PREVIEW_APPS.includes(match[1])) {
      counts.set(match[1], (counts.get(match[1]) ?? 0) + 1);
    }
  }
  let best = null;
  for (const [app, count] of counts) {
    if (!best || count > counts.get(best)) best = app;
  }
  return best;
}

export function holdConfig() {
  return `import base from "./playwright.config";

export default {
  ...base,
  testDir: "./.ai-review-preview",
  testMatch: "hold.spec.ts",
  testIgnore: [],
  fullyParallel: false,
  forbidOnly: false,
  retries: 0,
  workers: 1,
  timeout: 0,
  globalTimeout: 0,
  projects: [{ name: "preview" }],
};
`;
}

export function holdSpec() {
  return `import { copyFileSync, existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { test } from "@playwright/test";

const shared = ${JSON.stringify(SHARED)};
const skipped = new Set(["node_modules", ".wrangler", ".turbo", "build", ".react-router"]);

function storageStates(directory, found = []) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (!entry.isDirectory() || skipped.has(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.name === "storage-state") {
      for (const file of readdirSync(path)) if (file.endsWith(".json")) found.push(join(path, file));
    } else storageStates(path, found);
  }
  return found;
}

test("preview", async () => {
  test.setTimeout(0);
  const states = join(shared, "states");
  mkdirSync(states, { recursive: true });
  const names = [];
  for (const file of storageStates(process.cwd())) {
    copyFileSync(file, join(states, basename(file)));
    names.push(basename(file));
  }
  writeFileSync(
    join(shared, "ready.json"),
    JSON.stringify({ baseURL: test.info().project.use.baseURL ?? null, states: names }),
  );
  while (!existsSync(join(shared, "stop"))) await new Promise((done) => setTimeout(done, 1000));
});
`;
}

export function runCommand(
  command,
  args,
  { input, timeoutMs = 30 * 60 * 1000, maxOutput = MAX_OUTPUT } = {},
) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let overflow = false;
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    const collect = (append) => (data) => {
      if (overflow) return;
      if (stdout.length + stderr.length + data.length > maxOutput) {
        overflow = true;
        child.kill("SIGKILL");
        return;
      }
      append(String(data));
    };
    child.stdout.on(
      "data",
      collect((text) => {
        stdout += text;
      }),
    );
    child.stderr.on(
      "data",
      collect((text) => {
        stderr += text;
      }),
    );
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      if (overflow) reject(new Error(`${command} ${args.slice(0, 2).join(" ")} wrote too much`));
      else if (code === 0) resolve({ stdout, stderr });
      else {
        const error = new Error(
          `${command} ${args.slice(0, 2).join(" ")} exited with ${code ?? signal}`,
        );
        error.stdout = stdout;
        error.stderr = stderr;
        reject(error);
      }
    });
    if (input instanceof Buffer || typeof input === "string") child.stdin.end(input);
    else if (input) input.pipe(child.stdin);
    else child.stdin.end();
  });
}

export function readyInfo(text) {
  if (text.length > MAX_READY) throw new Error("the preview's ready.json is too large");
  let ready;
  try {
    ready = JSON.parse(text);
  } catch {
    throw new Error("the preview's ready.json is not JSON");
  }
  const baseURL = ready?.baseURL;
  if (
    typeof baseURL !== "string" ||
    !/^http:\/\/(localhost|127\.0\.0\.1):\d{2,5}\/?$/.test(baseURL)
  ) {
    throw new Error("the preview's base URL is not a loopback http URL");
  }
  const states = ready.states ?? [];
  if (
    !Array.isArray(states) ||
    states.length > 20 ||
    !states.every((name) => typeof name === "string" && /^[\w.-]{1,64}\.json$/.test(name))
  ) {
    throw new Error("the preview's storage states are not a list of file names");
  }
  return { baseURL, states };
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

export class Preview {
  constructor({ id, run = runCommand, wait = sleep, now = Date.now, log = console.log }) {
    this.container = `gdg-preview-${id}`;
    this.volume = `gdg-preview-${id}`;
    this.run = run;
    this.wait = wait;
    this.now = now;
    this.log = log;
  }

  async pull(image, attempts = 3) {
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await this.run("docker", ["pull", "-q", image]);
      } catch (error) {
        if (attempt >= attempts) throw error;
        await this.wait(10000 * attempt);
      }
    }
  }

  archive(dir) {
    return spawn("git", ["-C", dir, "archive", "--format=tar", "HEAD"], {
      stdio: ["ignore", "pipe", "inherit"],
    }).stdout;
  }

  exec(script, options = {}) {
    return this.run(
      "docker",
      [
        "exec",
        ...(options.stdin ? ["-i"] : []),
        "-w",
        options.cwd ?? "/work",
        this.container,
        "bash",
        "-ec",
        script,
      ],
      options,
    );
  }

  async start({ dir, app }) {
    await this.stop();
    for (const image of [APP_IMAGE, BROWSER_IMAGE]) await this.pull(image);
    await this.run("docker", ["volume", "create", this.volume]);
    await this.run("docker", [
      "run",
      "-d",
      "--name",
      this.container,
      "--network",
      "bridge",
      "--memory",
      "12g",
      "--pids-limit",
      "8192",
      "--security-opt",
      "no-new-privileges",
      "-v",
      `${this.volume}:${SHARED}`,
      "-e",
      "CI=true",
      APP_IMAGE,
      "sleep",
      "infinity",
    ]);
    await this.run("docker", ["exec", this.container, "mkdir", "-p", "/work"]);
    await this.exec("tar -x -f -", { stdin: true, input: this.archive(dir) });
    const submodules = [];
    for (const submodule of SUBMODULES) {
      const { stdout } = await this.run("git", ["-C", dir, "ls-tree", "HEAD", submodule.path]);
      const sha = /^160000 commit ([0-9a-f]{40})\t/.exec(stdout)?.[1];
      if (sha) submodules.push({ ...submodule, sha });
    }
    await this.exec(
      [
        "apt-get update -qq && apt-get install -y -qq --no-install-recommends git sqlite3 >/dev/null",
        "git init -q .",
        ...submodules.flatMap(({ path, url, sha }) => [
          `rm -rf ${shellQuote(path)} && git init -q ${shellQuote(path)}`,
          `git -C ${shellQuote(path)} fetch -q --depth 1 ${shellQuote(url)} ${sha}`,
          `git -C ${shellQuote(path)} -c advice.detachedHead=false checkout -q FETCH_HEAD`,
        ]),
      ].join("\n"),
    );
    await this.exec(`npm install --global --userconfig=/dev/null --silent pnpm@${PNPM}`, {
      cwd: "/",
    });
    await this.exec(
      `pnpm install --frozen-lockfile --ignore-scripts --ignore-pnpmfile ${PNPM_FLAGS}`,
    );
    await this.exec(
      `mkdir -p apps/${app}/.ai-review-preview && cat > apps/${app}/ai-review-preview.config.ts`,
      {
        stdin: true,
        input: holdConfig(),
      },
    );
    await this.exec(`cat > apps/${app}/.ai-review-preview/hold.spec.ts`, {
      stdin: true,
      input: holdSpec(),
    });
    await this.run("docker", ["network", "disconnect", "bridge", this.container]);
    await this.exec(`pnpm rebuild ${PNPM_FLAGS}`);
    await this.run("docker", [
      "exec",
      "-d",
      "-w",
      "/work",
      this.container,
      "bash",
      "-c",
      `node scripts/run-isolated-e2e.mjs --workspace @gdgjp/${app} -- --config ai-review-preview.config.ts > ${SHARED}/log.txt 2>&1; echo $? > ${SHARED}/exit`,
    ]);
    const deadline = this.now() + READY_TIMEOUT_MS;
    while (this.now() < deadline) {
      const { stdout } = await this.exec(
        `if test -f ${SHARED}/ready.json; then head -c ${MAX_READY + 1} ${SHARED}/ready.json; elif test -f ${SHARED}/exit; then echo EXITED; fi`,
      );
      if (stdout.trim() === "EXITED")
        throw new Error(`the preview stopped: ${await this.logTail()}`);
      if (stdout.trim()) {
        const ready = readyInfo(stdout);
        this.log(`Preview of apps/${app} is ready at ${ready.baseURL}`);
        return ready;
      }
      await this.wait(5000);
    }
    throw new Error(`the preview did not start within 25 minutes: ${await this.logTail()}`);
  }

  async logTail() {
    const { stdout } = await this.exec(`tail -c 3000 ${SHARED}/log.txt 2>/dev/null || true`).catch(
      () => ({ stdout: "" }),
    );
    return stdout.trim();
  }

  codexConfig() {
    const args = [
      "run",
      "-i",
      "--rm",
      "--init",
      "--network",
      `container:${this.container}`,
      "-v",
      `${this.volume}:${SHARED}:ro`,
      "-w",
      `${SHARED}/states`,
      "--cap-drop",
      "ALL",
      "--security-opt",
      "no-new-privileges",
      "--entrypoint",
      "node",
      BROWSER_IMAGE,
      "/app/cli.js",
      "--headless",
      "--browser",
      "chromium",
      "--no-sandbox",
      "--isolated",
      "--caps",
      "storage",
      "--output-dir",
      "/tmp/playwright-mcp",
    ];
    return [
      "-c",
      'mcp_servers.browser.command="docker"',
      "-c",
      `mcp_servers.browser.args=${JSON.stringify(args)}`,
      "-c",
      "mcp_servers.browser.startup_timeout_sec=180",
      "-c",
      "mcp_servers.browser.tool_timeout_sec=120",
      "-c",
      'mcp_servers.browser.default_tools_approval_mode="approve"',
      "-c",
      `mcp_servers.browser.disabled_tools=${JSON.stringify(DISABLED_TOOLS)}`,
    ];
  }

  async stop() {
    await this.run("docker", ["rm", "-f", this.container]).catch(() => undefined);
    await this.run("docker", ["volume", "rm", "-f", this.volume]).catch(() => undefined);
  }
}
