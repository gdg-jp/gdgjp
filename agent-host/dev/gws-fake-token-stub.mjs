#!/usr/bin/env node
// Test-only stand-in for the authz socket's /resolve and /workspace-token
// endpoints (cli/internal/wiki/hooks/acl-core.ts's resolveAuthz() and
// resolveWorkspaceToken()). Lets a developer exercise gws.ts's mediator path
// end to end — allowlist check, token fetch, env wiring into gws-bin —
// without a real Discord invocation, xangi authz-server, or Google OAuth
// consent. The returned access token is a fixed, obviously-fake string: any
// `gws` call that actually reaches Google will fail with a 401, which is
// expected. Never point a real slot's XANGI_AUTHZ_SOCKET at this outside of
// this dev flow, and never run this against anything but a disposable VM.
import { chmodSync, chownSync, existsSync, rmSync } from "node:fs";
import { createServer } from "node:http";

const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) {
  args.set(process.argv[i], process.argv[i + 1]);
}
const socketPath = args.get("--socket");
const nonce = args.get("--nonce");
const gdgSub = args.get("--sub");
const gid = args.get("--gid");
if (!socketPath || !nonce || !gdgSub || !gid || !/^\d+$/.test(gid)) {
  console.error("Usage: gws-fake-token-stub.mjs --socket PATH --nonce NONCE --sub SUB --gid GID");
  process.exit(2);
}

const FAKE_ACCESS_TOKEN = `fake-dev-token-not-a-real-google-credential-${Date.now()}`;

function log(...parts) {
  console.log("[gws-fake-token-stub]", ...parts);
}

function send(res, status, body) {
  const json = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(json),
  });
  res.end(json);
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  const gotNonce = url.searchParams.get("nonce");
  if (gotNonce !== nonce) {
    log(`rejected ${url.pathname} with wrong or missing nonce`);
    send(res, 401, { error: "invalid nonce" });
    return;
  }
  if (url.pathname === "/resolve") {
    log(`/resolve -> gdgSub=${gdgSub}`);
    send(res, 200, { classes: [], channelAudience: { kind: "private" }, gdgSub });
    return;
  }
  if (url.pathname === "/workspace-token") {
    log("/workspace-token -> fake access token issued");
    send(res, 200, { access_token: FAKE_ACCESS_TOKEN });
    return;
  }
  send(res, 404, { error: "not found" });
});

if (existsSync(socketPath)) rmSync(socketPath);
server.listen(socketPath, () => {
  chownSync(socketPath, process.getuid?.() ?? 0, Number(gid));
  chmodSync(socketPath, 0o660);
  log(`listening on ${socketPath}`);
  log("this is a fake, test-only stand-in for the real authz socket.");
  log("real gws calls to Google will fail with 401 using the issued token; that is expected.");
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    server.close();
    rmSync(socketPath, { force: true });
    process.exit(0);
  });
}
