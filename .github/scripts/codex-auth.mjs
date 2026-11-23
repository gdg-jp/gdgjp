import { execFile } from "node:child_process";
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createSign,
  randomBytes,
  scryptSync,
} from "node:crypto";
import { appendFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

const API_URL = "https://api.github.com";
const API_VERSION = "2026-03-10";
export const ARTIFACT_NAME = "codex-auth";
export const ENCRYPTED_FILE = "codex-auth.enc";
const KEPT_ARTIFACTS = 3;
const MIN_SECRET_LENGTH = 20;

const TOKEN_MARGIN_MS = 10 * 60 * 1000;
const TRUSTED_BRANCHES = ["main"];
const TRUSTED_WORKFLOWS = [".github/workflows/ai-review.yml", ".github/workflows/ai-login.yml"];
const TRUSTED_EVENTS = ["workflow_dispatch", "schedule", "push"];

export function appJwt(appId, privateKey, now = Date.now()) {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const issuedAt = Math.floor(now / 1000) - 60;
  const unsigned = `${encode({ alg: "RS256", typ: "JWT" })}.${encode({
    iat: issuedAt,
    exp: issuedAt + 540,
    iss: String(appId),
  })}`;
  const signature = createSign("RSA-SHA256").update(unsigned).sign(privateKey, "base64url");
  return `${unsigned}.${signature}`;
}

export class AppTokenSource {
  constructor({ appId, privateKey, repository, fetchImpl = fetch, now = () => Date.now() }) {
    this.appId = appId;
    this.privateKey = privateKey;
    this.repository = repository;
    this.fetchImpl = fetchImpl;
    this.now = now;
    this.current = null;
    this.issued = [];
    this.onIssue = null;
  }

  async call(path, method) {
    const response = await this.fetchImpl(`${API_URL}${path}`, {
      method,
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${appJwt(this.appId, this.privateKey, this.now())}`,
        "X-GitHub-Api-Version": API_VERSION,
        "User-Agent": "gdgjp-ai-review",
      },
    });
    if (!response.ok) {
      throw new Error(`GitHub App ${method} ${path} failed with ${response.status}`);
    }
    return response.json();
  }

  async token() {
    if (this.current && Date.parse(this.current.expires_at) - this.now() > TOKEN_MARGIN_MS) {
      return this.current.token;
    }
    if (!this.appId || !this.privateKey) {
      throw new Error("GDG_CHAN_APP_ID and GDG_CHAN_PRIVATE_KEY must be set");
    }
    this.installation ??= (await this.call(`/repos/${this.repository}/installation`, "GET")).id;
    this.current = await this.call(`/app/installations/${this.installation}/access_tokens`, "POST");
    this.issued.push(this.current.token);
    this.onIssue?.(this.current.token);
    return this.current.token;
  }
}

export class GitHubClient {
  constructor({ token, tokens, fetchImpl = fetch }) {
    this.token = token;
    this.tokens = tokens;
    this.fetchImpl = fetchImpl;
    this.runPaths = new Map();
  }

  async raw(path, { method = "GET", body, redirect = "follow" } = {}) {
    const response = await this.fetchImpl(path.startsWith("http") ? path : `${API_URL}${path}`, {
      method,
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${this.tokens ? await this.tokens.token() : this.token}`,
        "X-GitHub-Api-Version": API_VERSION,
        "User-Agent": "gdgjp-codex-review",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect,
    });
    if (redirect === "manual" && response.status >= 300 && response.status < 400) {
      return response;
    }
    if (!response.ok) {
      const details = await response.text();
      throw new Error(`GitHub API ${method} ${path} failed with ${response.status}: ${details}`);
    }
    return response;
  }

  async request(path, options) {
    const response = await this.raw(path, options);
    return response.status === 204 ? undefined : response.json();
  }

  async list(path) {
    const items = [];
    for (let page = 1; ; page += 1) {
      const separator = path.includes("?") ? "&" : "?";
      const result = await this.request(`${path}${separator}per_page=100&page=${page}`);
      items.push(...result);
      if (result.length < 100) return items;
    }
  }

  async graphql(query, variables) {
    const result = await this.request("/graphql", { method: "POST", body: { query, variables } });
    if (result.errors?.length) {
      throw new Error(`GitHub GraphQL failed: ${JSON.stringify(result.errors)}`);
    }
    return result.data;
  }

  async run(id) {
    if (!this.runPaths.has(id)) {
      const repository = process.env.GITHUB_REPOSITORY;
      this.runPaths.set(id, await this.request(`/repos/${repository}/actions/runs/${id}`));
    }
    return this.runPaths.get(id);
  }

  async artifacts(name, trust = trustedSources()) {
    const repository = process.env.GITHUB_REPOSITORY;
    const all = [];
    for (let page = 1; ; page += 1) {
      const result = await this.request(
        `/repos/${repository}/actions/artifacts?name=${encodeURIComponent(name)}&per_page=100&page=${page}`,
      );
      all.push(...result.artifacts);
      if (result.artifacts.length < 100) break;
    }
    const trusted = [];
    for (const artifact of newestFirst(all.filter((item) => !item.expired))) {
      const source = artifact.workflow_run;
      if (!source || source.head_repository_id !== source.repository_id) continue;
      if (!trust.branches.includes(source.head_branch)) continue;
      const run = await this.run(source.id);
      if (run.head_repository?.full_name !== repository) continue;
      if (!trust.workflows.includes(run.path) || !trust.events.includes(run.event)) continue;
      trusted.push(artifact);
    }
    return trusted;
  }

  async latestArtifact(name) {
    return (await this.artifacts(name))[0] ?? null;
  }

  async download(artifact) {
    const redirect = await this.raw(artifact.archive_download_url, { redirect: "manual" });
    const location = redirect.headers.get("location");
    const response = location ? await this.fetchImpl(location) : redirect;
    if (!response.ok) {
      throw new Error(`Downloading artifact ${artifact.id} failed with ${response.status}`);
    }
    return Buffer.from(await response.arrayBuffer());
  }
}

export function trustedSources(env = process.env) {
  const list = (value, fallback) =>
    value
      ? value
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean)
      : fallback;
  return {
    branches: list(env.AI_REVIEW_TRUSTED_BRANCHES, TRUSTED_BRANCHES),
    workflows: list(env.AI_REVIEW_TRUSTED_WORKFLOWS, TRUSTED_WORKFLOWS),
    events: list(env.AI_REVIEW_TRUSTED_EVENTS, TRUSTED_EVENTS),
  };
}

export function newestFirst(artifacts) {
  return [...artifacts].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
}

function key(secret) {
  if (!secret || secret.length < 32) {
    throw new Error("CODEX_AUTH_KEY must be set to a random value of at least 32 characters");
  }
  return scryptSync(secret, "gdgjp-codex-auth", 32);
}

export function encrypt(plaintext, secret) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(secret), iv);
  const data = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return JSON.stringify({
    v: 1,
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    data: data.toString("base64"),
  });
}

export function decrypt(envelope, secret) {
  const parsed = JSON.parse(envelope);
  const decipher = createDecipheriv("aes-256-gcm", key(secret), Buffer.from(parsed.iv, "base64"));
  decipher.setAuthTag(Buffer.from(parsed.tag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(parsed.data, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

export function authSecrets(auth) {
  const values = new Set();
  const walk = (value) => {
    if (typeof value === "string" && value.length >= MIN_SECRET_LENGTH) values.add(value);
    else if (value && typeof value === "object") Object.values(value).forEach(walk);
  };
  walk(auth);
  for (const value of [...values]) {
    for (const part of value.split(".")) {
      if (part.length >= MIN_SECRET_LENGTH) values.add(part);
    }
  }
  return [...values].sort((a, b) => b.length - a.length);
}

export async function readAuthSecrets(path) {
  try {
    return authSecrets(JSON.parse(await readFile(path, "utf8")));
  } catch {
    return [];
  }
}

export function redact(text, secrets) {
  let result = String(text);
  for (const secret of secrets) result = result.split(secret).join("[redacted]");
  return result.replace(/eyJ[\w-]{10,}\.[\w-]{10,}\.[\w-]{10,}/g, "[redacted]");
}

export function parseDeviceLogin(output) {
  const plain = output.replaceAll(`${String.fromCharCode(27)}[`, "[").replace(/\[[0-9;]*m/g, "");
  const url = /https:\/\/[\w.-]+\/[\w/.-]*device\b/.exec(plain)?.[0];
  const code = /\b([A-Z0-9]{4,}-[A-Z0-9]{4,})\b/.exec(plain)?.[1];
  return url && code ? { url, code } : null;
}

export function accountEmail(auth) {
  const payload = auth?.tokens?.id_token?.split(".")[1];
  if (!payload) return null;
  try {
    return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")).email ?? null;
  } catch {
    return null;
  }
}

export function verifyAccount(auth, expectedDigest) {
  if (!expectedDigest) {
    throw new Error("CODEX_ACCOUNT_SHA256 must name the ChatGPT account the agent signs in with");
  }
  const email = accountEmail(auth);
  const actual = email ? digest(email.trim().toLowerCase()) : null;
  if (actual !== expectedDigest.trim().toLowerCase()) {
    throw new Error(
      "The Codex login belongs to a different ChatGPT account than CODEX_ACCOUNT_SHA256",
    );
  }
}

function digest(text) {
  return createHash("sha256").update(text).digest("hex");
}

async function setOutput(name, value) {
  if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);
}

async function restore({ github, codexHome, secret, account }) {
  const artifact = await github.latestArtifact(ARTIFACT_NAME);
  if (!artifact) {
    throw new Error("No trusted Codex login is stored. Run the AI login workflow on main first.");
  }
  const scratch = await mkdtemp(join(tmpdir(), "codex-auth-"));
  try {
    const zip = join(scratch, "artifact.zip");
    await writeFile(zip, await github.download(artifact));
    const { stdout } = await promisify(execFile)("unzip", ["-p", zip, ENCRYPTED_FILE], {
      maxBuffer: 16 * 1024 * 1024,
    });
    const auth = decrypt(stdout, secret);
    verifyAccount(JSON.parse(auth), account);
    for (const value of authSecrets(JSON.parse(auth))) console.log(`::add-mask::${value}`);
    await mkdir(codexHome, { recursive: true, mode: 0o700 });
    await writeFile(join(codexHome, "auth.json"), auth, { mode: 0o600 });
    await writeFile(join(codexHome, ".restored-digest"), digest(auth));
    console.log(`Restored the Codex login saved at ${artifact.created_at}.`);
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

async function save({ codexHome, outDir, secret, account }) {
  const auth = await readFile(join(codexHome, "auth.json"), "utf8");
  verifyAccount(JSON.parse(auth), account);
  const previous = await readFile(join(codexHome, ".restored-digest"), "utf8").catch(() => "");
  if (previous === digest(auth)) {
    console.log("The Codex login did not change.");
    await setOutput("changed", "false");
    return;
  }
  await mkdir(outDir, { recursive: true });
  await writeFile(join(outDir, ENCRYPTED_FILE), encrypt(auth, secret));
  console.log("The Codex login changed and will be stored.");
  await setOutput("changed", "true");
}

async function prune({ github }) {
  const repository = process.env.GITHUB_REPOSITORY;
  const artifacts = await github.artifacts(ARTIFACT_NAME);
  for (const artifact of artifacts.slice(KEPT_ARTIFACTS)) {
    await github.request(`/repos/${repository}/actions/artifacts/${artifact.id}`, {
      method: "DELETE",
    });
  }
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  const github = new GitHubClient({ token: process.env.GITHUB_TOKEN });
  const secret = process.env.CODEX_AUTH_KEY;
  const account = process.env.CODEX_ACCOUNT_SHA256;
  if (command === "restore") return restore({ github, codexHome: args[0], secret, account });
  if (command === "save") return save({ codexHome: args[0], outDir: args[1], secret, account });
  if (command === "prune") return prune({ github });
  if (command === "check-key") {
    key(secret);
    if (!account) throw new Error("CODEX_ACCOUNT_SHA256 is not set");
    return;
  }
  if (command === "device-login") {
    const login = parseDeviceLogin(await readFile(args[0], "utf8"));
    if (!login) return process.exit(2);
    const message = `Open ${login.url} and enter the one-time code ${login.code} within 15 minutes.`;
    console.log(`::notice title=Codex login::${message}`);
    if (process.env.GITHUB_STEP_SUMMARY) {
      await appendFile(
        process.env.GITHUB_STEP_SUMMARY,
        `## Codex login\n\n1. Open <${login.url}> and sign in to ChatGPT.\n2. Enter the code \`${login.code}\`.\n\nThe code expires in 15 minutes. This run stores the login when you finish.\n`,
      );
    }
    return;
  }
  throw new Error(
    "Usage: node .github/scripts/codex-auth.mjs restore DIR | save DIR OUT | prune | check-key | device-login LOG",
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await main();
}
