import { execFile } from "node:child_process";
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { gunzipSync, gzipSync } from "node:zlib";
import { GitHubClient } from "./codex-auth.mjs";

export const SESSIONS_ARTIFACT = "codex-sessions";
export const CONTEXT_WINDOW = 500_000;
export const MAX_SESSION_BYTES = 48 * 1024 * 1024;
const KEPT_ARTIFACTS = 2;
const ROLLOUT =
  /^sessions\/(?:\d+\/)*rollout-[\w-]+-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/;
const SESSION_FILE = /^pr-(\d+)\.enc$/;

export async function rollouts(codexHome) {
  const found = new Map();
  const entries = await readdir(join(codexHome, "sessions"), { recursive: true }).catch(() => []);
  for (const entry of entries) {
    const path = `sessions/${entry.split("\\").join("/")}`;
    const match = ROLLOUT.exec(path);
    if (match) found.set(match[1], path);
  }
  return found;
}

function sessionKey(secret) {
  if (!secret) throw new Error("A key is needed to store Codex sessions");
  return Buffer.from(hkdfSync("sha256", secret, "gdgjp-ai-review", "codex-session v1", 32));
}

export function sealSession(session, number, secret) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", sessionKey(secret), iv);
  cipher.setAAD(Buffer.from(`pr-${number}`));
  const data = Buffer.concat([cipher.update(JSON.stringify(session)), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), data]);
}

export function openSession(sealed, number, secret) {
  const decipher = createDecipheriv("aes-256-gcm", sessionKey(secret), sealed.subarray(0, 12));
  decipher.setAAD(Buffer.from(`pr-${number}`));
  decipher.setAuthTag(sealed.subarray(12, 28));
  const text = Buffer.concat([decipher.update(sealed.subarray(28)), decipher.final()]);
  return JSON.parse(text.toString("utf8"));
}

export class SessionStore {
  constructor({ dir, codexHome, secret, log = console.log }) {
    this.dir = dir;
    this.codexHome = codexHome;
    this.secret = secret;
    this.log = log;
  }

  file(number) {
    return join(this.dir, `pr-${number}.enc`);
  }

  async load(number, model) {
    let sealed;
    try {
      sealed = await readFile(this.file(number));
    } catch {
      return null;
    }
    try {
      const session = openSession(sealed, number, this.secret);
      const match = ROLLOUT.exec(session.path);
      if (session.v !== 1 || !match || match[1] !== session.id) throw new Error("malformed");
      if (session.model !== model) {
        this.log(`The saved session of #${number} used ${session.model}; starting a new one.`);
        return null;
      }
      const target = join(this.codexHome, session.path);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, gunzipSync(Buffer.from(session.rollout, "base64")), { mode: 0o600 });
      return session.id;
    } catch (error) {
      this.log(`::warning::The saved Codex session of #${number} is unusable: ${error.message}`);
      await this.forget(number);
      return null;
    }
  }

  async store(number, model, id) {
    const path = (await rollouts(this.codexHome)).get(id);
    if (!path) {
      this.log(`::warning::Codex wrote no session file for #${number}.`);
      return;
    }
    const rollout = gzipSync(await readFile(join(this.codexHome, path)));
    if (rollout.length > MAX_SESSION_BYTES) {
      this.log(
        `The session of #${number} outgrew ${MAX_SESSION_BYTES} bytes; the next run starts over.`,
      );
      await this.forget(number);
      return;
    }
    await mkdir(this.dir, { recursive: true });
    const session = { v: 1, id, model, path, rollout: rollout.toString("base64") };
    await writeFile(this.file(number), sealSession(session, number, this.secret));
  }

  async forget(number) {
    await rm(this.file(number), { force: true });
  }

  async keepOnly(numbers) {
    const keep = new Set(numbers.map(Number));
    for (const name of await readdir(this.dir).catch(() => [])) {
      const match = SESSION_FILE.exec(name);
      if (!match || !keep.has(Number(match[1]))) await rm(join(this.dir, name), { force: true });
    }
  }
}

async function restore({ github, dir }) {
  await mkdir(dir, { recursive: true });
  const artifact = await github.latestArtifact(SESSIONS_ARTIFACT);
  if (!artifact) {
    console.log("No saved Codex sessions; every pull request starts a new one.");
    return;
  }
  const scratch = await mkdtemp(join(tmpdir(), "codex-sessions-"));
  try {
    const zip = join(scratch, "artifact.zip");
    await writeFile(zip, await github.download(artifact));
    await promisify(execFile)("unzip", ["-o", "-q", zip, "pr-*.enc", "-d", dir]);
    console.log(`Restored the Codex sessions saved at ${artifact.created_at}.`);
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

async function prune({ github }) {
  const repository = process.env.GITHUB_REPOSITORY;
  const artifacts = await github.artifacts(SESSIONS_ARTIFACT);
  for (const artifact of artifacts.slice(KEPT_ARTIFACTS)) {
    await github.request(`/repos/${repository}/actions/artifacts/${artifact.id}`, {
      method: "DELETE",
    });
  }
}

async function main() {
  const [command, dir] = process.argv.slice(2);
  const github = new GitHubClient({ token: process.env.GITHUB_TOKEN });
  try {
    if (command === "restore") return await restore({ github, dir });
    if (command === "prune") return await prune({ github });
  } catch (error) {
    console.log(`::warning::Codex sessions: ${command} failed: ${error.message}`);
    return;
  }
  throw new Error("Usage: node .github/scripts/ai-review-sessions.mjs restore DIR | prune");
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await main();
}
