import { existsSync, lstatSync, readFileSync, realpathSync } from "node:fs";
/** Shared, fail-closed ACL helpers for the local Wiki mediator and gate. */
import { request } from "node:http";
import { dirname, join, relative, resolve, sep } from "node:path";

// acl.ts is an esbuild bundle with @ts-nocheck, so keep its public input
// shapes local while delegating every authorization decision to that bundle.
export type PermissionClass = { chapterId: string; role: "organizer" | "member" };
export type SourceAudienceKey =
  | { kind: "private" | "member" | "organizer" }
  | { kind: "chapter-member" | "chapter-organizer"; chapterId: string };

export type Authz = { classes: PermissionClass[]; channelAudience: SourceAudienceKey };
export type SourceMeta = { visibility: string; chapterId: string | null };
export type PageMeta = SourceMeta & {
  access: Array<{ subjectType: string; subjectKey: string }>;
};

type AuthzResponse = {
  classes?: unknown;
  channelAudience?: unknown;
};

const sourceVisibilities = new Set([
  "private",
  "member",
  "organizer",
  "chapter-member",
  "chapter-organizer",
]);

export function fail(message: string): never {
  throw new Error(message);
}

export function findCloneRoot(start = process.cwd()): string {
  let dir = resolve(start);
  for (;;) {
    if (existsSync(join(dir, ".gdgwiki", "config.json"))) return realpathSync(dir);
    const parent = dirname(dir);
    if (parent === dir) fail("wk: not inside a Wiki clone");
    dir = parent;
  }
}

function isWithin(root: string, target: string): boolean {
  const rel = relative(root, target);
  return rel === "" || (!rel.startsWith("..") && !rel.startsWith(`..${sep}`));
}

/** Resolve an existing path, or an intended write target without following a missing leaf. */
export function resolveClonePath(
  root: string,
  input: string,
  forWrite = false,
): { absolute: string; rel: string } {
  if (!input) fail("wk: a path is required");
  const rootReal = realpathSync(root);
  const tentative = resolve(rootReal, input);
  let absolute: string;
  if (existsSync(tentative)) {
    absolute = realpathSync(tentative);
  } else if (forWrite) {
    const parent = dirname(tentative);
    if (!existsSync(parent)) fail("wk: parent directory does not exist");
    absolute = join(realpathSync(parent), tentative.slice(parent.length + 1));
  } else {
    fail("wk: path does not exist");
  }
  if (!isWithin(rootReal, absolute)) fail("wk: path is outside the Wiki clone");
  const rel = relative(rootReal, absolute).split(sep).join("/");
  if (!rel) fail("wk: clone root is not a readable file");
  return { absolute, rel };
}

function asClass(value: unknown): PermissionClass | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  return typeof item.chapterId === "string" && (item.role === "member" || item.role === "organizer")
    ? { chapterId: item.chapterId, role: item.role }
    : null;
}

function asAudience(value: unknown): SourceAudienceKey | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  if (item.kind === "private" || item.kind === "member" || item.kind === "organizer")
    return { kind: item.kind };
  if (
    (item.kind === "chapter-member" || item.kind === "chapter-organizer") &&
    typeof item.chapterId === "string" &&
    item.chapterId
  ) {
    return { kind: item.kind, chapterId: item.chapterId };
  }
  return null;
}

export async function resolveAuthz(): Promise<Authz> {
  const nonce = process.env.XANGI_AUTHZ_NONCE;
  const socketPath = process.env.XANGI_AUTHZ_SOCKET;
  if (!nonce || !socketPath)
    fail("wk: missing invocation authorization; retry from the agent launcher");
  const body = await new Promise<string>((ok, reject) => {
    const req = request(
      {
        socketPath,
        path: `/resolve?nonce=${encodeURIComponent(nonce)}`,
        method: "GET",
        host: "localhost",
      },
      (res) => {
        let data = "";
        res.setEncoding("utf8");
        res.on("data", (chunk: string) => {
          data += chunk;
        });
        res.on("end", () =>
          res.statusCode === 200
            ? ok(data)
            : reject(new Error(`authorization server returned ${res.statusCode}`)),
        );
      },
    );
    req.setTimeout(5_000, () => req.destroy(new Error("authorization server timed out")));
    req.on("error", reject);
    req.end();
  });
  let parsed: AuthzResponse;
  try {
    parsed = JSON.parse(body) as AuthzResponse;
  } catch {
    fail("wk: authorization server returned invalid JSON");
  }
  const classes = Array.isArray(parsed.classes)
    ? parsed.classes.map(asClass).filter((v): v is PermissionClass => v !== null)
    : null;
  const channelAudience = asAudience(parsed.channelAudience);
  if (classes === null || channelAudience === null)
    fail("wk: authorization response is incomplete; retry from the agent launcher");
  return { classes, channelAudience };
}

function unixRequest(
  socketPath: string,
  method: "GET" | "POST",
  path: string,
  timeoutMs = 5_000,
): Promise<{ status: number; body: string }> {
  return new Promise((ok, reject) => {
    const req = request({ socketPath, path, method, host: "localhost" }, (res) => {
      let data = "";
      res.setEncoding("utf8");
      res.on("data", (chunk: string) => {
        data += chunk;
      });
      res.on("end", () => ok({ status: res.statusCode ?? 0, body: data }));
    });
    req.setTimeout(timeoutMs, () => req.destroy(new Error("authorization server timed out")));
    req.on("error", reject);
    req.end();
  });
}

function unixGet(
  socketPath: string,
  path: string,
  timeoutMs = 5_000,
): Promise<{ status: number; body: string }> {
  return unixRequest(socketPath, "GET", path, timeoutMs);
}

/** Ask xangi to hold the repository mutex for this invocation. Fail closed. */
export async function acquireRepoLockViaAuthz(): Promise<void> {
  const nonce = process.env.XANGI_AUTHZ_NONCE;
  const socketPath = process.env.XANGI_AUTHZ_SOCKET;
  if (!nonce || !socketPath)
    fail("wk: missing invocation authorization; retry from the agent launcher");
  let status = 0;
  let body = "";
  try {
    ({ status, body } = await unixRequest(
      socketPath,
      "POST",
      `/repo-lock?nonce=${encodeURIComponent(nonce)}`,
      5_000,
    ));
  } catch (error) {
    fail(
      `wk: repository lock request failed; retry after the other task finishes (${
        error instanceof Error ? error.message : "error"
      })`,
    );
  }
  if (status === 200) return;
  fail(
    `wk: repository is locked by another invocation; retry after it finishes (${body.trim() || status})`,
  );
}

export type VerifyAclOutcome =
  | { kind: "ok" }
  | { kind: "violation"; findings: string }
  | { kind: "infra"; detail: string };

/** Ask the svc-side authorization server to run `gdg wiki verify-acl`. Fail-open on infra. */
export async function verifyAclViaAuthz(): Promise<VerifyAclOutcome> {
  const nonce = process.env.XANGI_AUTHZ_NONCE;
  const socketPath = process.env.XANGI_AUTHZ_SOCKET;
  if (!nonce || !socketPath) {
    return { kind: "infra", detail: "missing invocation authorization" };
  }
  try {
    const { status, body } = await unixGet(
      socketPath,
      `/verify-acl?nonce=${encodeURIComponent(nonce)}`,
      8_000,
    );
    if (status === 200) return { kind: "ok" };
    if (status === 409 || status === 404 || status === 401 || status === 403 || status === 429) {
      let findings = body.trim();
      try {
        const parsed = JSON.parse(body) as { findings?: unknown; error?: unknown };
        if (typeof parsed.findings === "string") findings = parsed.findings;
        else if (typeof parsed.error === "string") findings = parsed.error;
      } catch {
        // Keep the raw body.
      }
      return { kind: "violation", findings: findings || "ACL check failed" };
    }
    if (status === 503) {
      return { kind: "infra", detail: body.trim() || "authorization server unavailable" };
    }
    return { kind: "infra", detail: `authorization server returned ${status}` };
  } catch (error) {
    const detail = error instanceof Error ? error.message : "verify-acl unavailable";
    return { kind: "infra", detail };
  }
}

function scalar(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return "";
  const quote = trimmed[0];
  if ((quote === '"' || quote === "'") && trimmed.at(-1) === quote) return trimmed.slice(1, -1);
  return /^[A-Za-z0-9_./:-]+$/.test(trimmed) ? trimmed : null;
}

/** Strictly reads the small front-matter subset emitted by LocalPages. */
function frontMatter(markdown: string): Map<string, string> {
  const end = markdown.indexOf("\n---\n", 4);
  if (!markdown.startsWith("---\n") || end < 0) fail("wk: invalid page front matter");
  const fields = new Map<string, string>();
  for (const line of markdown.slice(4, end).split("\n")) {
    const match = /^([a-z_]+):(?:\s(.*))?$/.exec(line);
    if (!match) continue;
    const value = scalar(match[2] ?? "");
    if (value !== null) fields.set(match[1], value);
  }
  return fields;
}

export function readPageMeta(markdown: string): PageMeta {
  const fields = frontMatter(markdown);
  const visibility = fields.get("visibility");
  if (
    !visibility ||
    !["public", "unlisted", "member", "organizer", "restricted"].includes(visibility)
  )
    fail("wk: page visibility is missing or invalid");
  const chapterId = fields.get("chapter_id") ?? null;
  // LocalPages persist a chapter-scoped restricted page as `restricted` plus
  // `chapter_id`. Treat only that compact, validated shape as a chapter grant.
  // Any other restricted shape remains deny-by-default.
  const access =
    visibility === "restricted" && chapterId
      ? [{ subjectType: "chapter", subjectKey: chapterId }]
      : [];
  return { visibility, chapterId, access };
}

export function isPagePath(rel: string): boolean {
  return /^pages\/(?:[^/]+\/)*page\.md$/.test(rel);
}
export function isAlwaysVisible(rel: string): boolean {
  return (
    rel === "AGENTS.md" ||
    rel === "INGEST_QUEUE.md" ||
    rel.startsWith(".gdgwiki/") ||
    /^pages\/(?:[^/]+\/)*(?:log|catalog)\/page\.md$/.test(rel)
  );
}

export function sourceMetaFromManifest(root: string, rel: string): SourceMeta {
  let state: unknown;
  try {
    state = JSON.parse(requireText(join(root, ".gdgwiki", "state.json")));
  } catch {
    fail("wk: cannot read local source manifest; run gdg wiki raw pull");
  }
  const documents = (state as { manifest?: { documents?: unknown } }).manifest?.documents;
  if (!Array.isArray(documents)) fail("wk: local source manifest is missing");
  const match = documents.find(
    (doc) => doc && typeof doc === "object" && (doc as { path?: unknown }).path === rel,
  ) as Record<string, unknown> | undefined;
  if (
    !match ||
    typeof match.visibility !== "string" ||
    !sourceVisibilities.has(match.visibility) ||
    !("chapterId" in match)
  )
    fail("wk: source metadata is unresolved; run gdg wiki raw pull");
  const chapterId = match.chapterId;
  if (chapterId !== null && typeof chapterId !== "string")
    fail("wk: source chapter metadata is invalid");
  return { visibility: match.visibility, chapterId };
}

export function sourceMetaFromMemory(markdown: string): SourceMeta {
  const fields = frontMatter(markdown);
  const visibility = fields.get("visibility");
  if (!visibility || !sourceVisibilities.has(visibility))
    fail("wk: memory visibility is missing or invalid");
  return { visibility, chapterId: fields.get("chapter_id") ?? null };
}

export function loadAclSources(root: string): Record<string, SourceMeta> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(requireText(join(root, ".gdgwiki", "acl-sources.json")));
  } catch {
    return {};
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
  const out: Record<string, SourceMeta> = {};
  for (const [id, value] of Object.entries(parsed)) {
    if (!value || typeof value !== "object") continue;
    const item = value as Record<string, unknown>;
    if (
      typeof item.visibility === "string" &&
      sourceVisibilities.has(item.visibility) &&
      (item.chapterId === null || typeof item.chapterId === "string")
    )
      out[id] = { visibility: item.visibility, chapterId: item.chapterId };
  }
  return out;
}

export function requireText(path: string): string {
  try {
    if (lstatSync(path).isSymbolicLink()) fail("wk: symlinked files are not allowed");
    return readFileSync(path, "utf8");
  } catch {
    fail(`wk: cannot read ${path}`);
  }
}
