import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { createServer as createNetServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  devLogin,
  forbiddenPresent,
  identityLogins,
  profiles,
  requiredPorts,
  selectProfiles,
} from "./app-stack-profiles.mjs";
import {
  checkApplication,
  cookiesFrom,
  doctorStack,
  fontDirectory,
  mergeVariables,
  parseArguments,
  probe,
  readPlatform,
  readVariables,
  signIn,
} from "./app-stack.mjs";

function listen(handler) {
  return new Promise((done) => {
    const server = createServer(handler);
    server.listen(0, "127.0.0.1", () => done(server));
  });
}

test("arguments select known apps and reject unknown ones", () => {
  const options = parseArguments(["--app", "pr,pay,pr", "--serve", "--no-seed"]);
  assert.deepEqual(options.apps, ["pr", "pay"]);
  assert.equal(options.mode, "serve");
  assert.equal(options.seed, false);
  assert.throws(() => parseArguments(["--app", "wiki"]), /Unknown app: wiki/);
  assert.throws(() => parseArguments([]), /Choose --app/);
  assert.throws(() => parseArguments(["--app", "pr", "--deploy"]), /Unknown argument/);
  assert.equal(parseArguments(["--help"]).mode, "help");
});

test("ports stay in a block apart from the isolated E2E runner and include companions", () => {
  assert.deepEqual(requiredPorts(["pr"]), [6161, 6162, 6163]);
  assert.deepEqual(requiredPorts(["connpass", "pay"]), [6166, 6167, 6164]);
  assert.deepEqual(requiredPorts(["scheduler", "tinyurl", "sns"]), [6168, 6169, 6165]);
  const all = requiredPorts(Object.keys(profiles));
  assert.equal(new Set(all).size, all.length);
  const runner = readFileSync(new URL("../run-isolated-e2e.mjs", import.meta.url), "utf8");
  const reserved = new Set([...runner.matchAll(/\b(\d{4})\b/g)].map(([, port]) => Number(port)));
  for (const port of all) {
    assert.ok(port >= 6160 && port <= 6169, `${port} is outside the verification block`);
    assert.equal(reserved.has(port), false, `${port} is used by the isolated E2E runner`);
  }
});

test("dev logins encode every chapter, admin only when asked, and a return path", () => {
  const url = new URL(
    devLogin("lead", ["1:gdg-kwansai:organizer", "2:x:member"], { returnTo: "/c/a" }),
    "http://localhost:6161",
  );
  assert.equal(url.pathname, "/dev/login");
  assert.deepEqual(url.searchParams.getAll("chapter"), ["1:gdg-kwansai:organizer", "2:x:member"]);
  assert.equal(url.searchParams.get("admin"), null);
  assert.equal(url.searchParams.get("return_to"), "/c/a");
  const logins = identityLogins("tinyurl");
  assert.equal(new URL(logins.admin.url).searchParams.get("admin"), "1");
  assert.equal(new URL(logins.owner.url).searchParams.get("admin"), null);
  assert.equal(logins.owner.userId, "dev-user-owner");
  assert.deepEqual(selectProfiles(" pay , sns "), ["pay", "sns"]);
});

test("variables merge test overrides and the credential gate finds non-empty secrets", () => {
  const text = 'A=1\n# B=2\nCONNPASS_BOT_EMAIL="bot@example.invalid"\nEMPTY=\n';
  assert.deepEqual(readVariables(text), {
    A: "1",
    CONNPASS_BOT_EMAIL: "bot@example.invalid",
    EMPTY: "",
  });
  assert.equal(mergeVariables("A=1\nB=2\n", { B: "3", C: "4" }), "A=1\nB=3\nC=4\n");
  assert.deepEqual(
    forbiddenPresent(readVariables(text), ["CONNPASS_BOT_EMAIL", "EMPTY", "MISSING"]),
    ["CONNPASS_BOT_EMAIL"],
  );
  for (const name of ["connpass", "pay", "sns"]) {
    assert.ok(profiles[name].forbiddenVariables.length > 0);
  }
  assert.deepEqual(profiles.sns.variables.X_API_BASE_URL, "http://127.0.0.1:9");
});

test("doctor names missing prerequisites before touching ports", async () => {
  const source = mkdtempSync(join(tmpdir(), "app-stack-doctor-"));
  try {
    await assert.rejects(
      doctorStack({ source, apps: ["pay"] }),
      /Missing prerequisite: .*apps\/pay\/package.json.*verify-pay\/fixtures\/seed.sql/,
    );
  } finally {
    rmSync(source, { recursive: true, force: true });
  }
});

test("doctor refuses an occupied port without stopping its owner", async () => {
  const source = mkdtempSync(join(tmpdir(), "app-stack-port-"));
  const blocker = createNetServer();
  const owned = await new Promise((done) => {
    blocker.once("error", () => done(false));
    blocker.listen(6168, "127.0.0.1", () => done(true));
  });
  try {
    for (const path of [
      "package.json",
      "pnpm-workspace.yaml",
      "node_modules",
      "packages/gdg-lib/package.json",
      "scripts/run-e2e-dev.mjs",
      "apps/scheduler/package.json",
      "apps/scheduler/node_modules",
      "packages/design-system/package.json",
      ".agents/skills/verify-scheduler/fixtures/seed.sql",
    ]) {
      mkdirSync(join(source, path, ".."), { recursive: true });
      if (path.endsWith("node_modules")) mkdirSync(join(source, path), { recursive: true });
      else writeFileSync(join(source, path), "{}");
    }
    await assert.rejects(doctorStack({ source, apps: ["scheduler"] }), /6168 .* occupied/);
    assert.equal(blocker.listening, owned);
  } finally {
    if (owned) await new Promise((done) => blocker.close(done));
    rmSync(source, { recursive: true, force: true });
  }
});

test("platform attachment requires a running verify-platform registry", () => {
  const scratch = mkdtempSync(join(tmpdir(), "app-stack-platform-"));
  try {
    const ready = join(scratch, "ready.json");
    writeFileSync(
      ready,
      JSON.stringify({ scratch, origins: { accounts: "http://localhost:6173" } }),
    );
    assert.throws(() => readPlatform(ready), /not running/);
    mkdirSync(join(scratch, ".e2e-registry"));
    assert.deepEqual(readPlatform(ready), {
      readyPath: ready,
      accounts: "http://localhost:6173",
      registry: join(scratch, ".e2e-registry"),
      accountsDirectory: join(scratch, "apps/accounts"),
    });
    assert.equal(readPlatform(null), null);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

test("font seeding uses only a local cache", () => {
  const source = mkdtempSync(join(tmpdir(), "app-stack-fonts-"));
  try {
    assert.equal(fontDirectory(source), null);
    const cache = join(source, "apps/pr/node_modules/.cache/gdg-fonts");
    mkdirSync(cache, { recursive: true });
    writeFileSync(join(cache, "notes.txt"), "");
    assert.equal(fontDirectory(source), null);
    writeFileSync(join(cache, "A.ttf"), "");
    assert.deepEqual(fontDirectory(source).files, ["A.ttf"]);
  } finally {
    rmSync(source, { recursive: true, force: true });
  }
});

test("readiness needs the real sign-in cookie and the expected signed-in text", async () => {
  const server = await listen((request, response) => {
    const url = new URL(request.url, "http://127.0.0.1");
    if (url.pathname === "/dev/login") {
      response.writeHead(302, {
        location: url.searchParams.get("return_to"),
        "set-cookie": [`gdgjp-pay-session=${url.searchParams.get("as")}; Path=/; HttpOnly`],
      });
      return response.end();
    }
    if (request.headers.cookie === "gdgjp-pay-session=organizer") {
      response.writeHead(200, { "content-type": "text/html" });
      return response.end('<nav aria-label="イベント一覧"></nav>');
    }
    response.writeHead(200, { "content-type": "text/html" });
    response.end('<section aria-label="利用案内"></section>');
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const cookie = await signIn(base, devLogin("organizer", ["1:gdg-tokyo:organizer"]));
    assert.equal(cookie, "gdgjp-pay-session=organizer");
    const saved = [];
    const checks = await checkApplication("pay", base, (label) => saved.push(label));
    assert.equal(checks.anonymous.ok, true);
    assert.equal(checks.identity.ok, true);
    assert.equal(checks.identity.userId, "dev-user-organizer");
    assert.equal("body" in checks.identity, false);
    assert.deepEqual(saved, ["pay-anonymous", "pay-organizer"]);
    const missing = await probe(base, { path: "/", text: "not rendered" });
    assert.equal(missing.ok, false);
    assert.equal(missing.expectedTextFound, false);
  } finally {
    await new Promise((done) => server.close(done));
  }
});

test("sign-in without a session cookie and redirect probes fail closed", async () => {
  const server = await listen((request, response) => {
    if (request.url.startsWith("/dev/login")) {
      response.writeHead(404);
      return response.end();
    }
    response.writeHead(302, { location: "/signin?return_to=%2Fposts" });
    response.end();
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await assert.rejects(signIn(base, devLogin("x")), /HTTP 404/);
    assert.equal((await probe(base, { path: "/posts", redirect: "/signin" })).ok, true);
    assert.equal((await probe(base, { path: "/posts", redirect: "/elsewhere" })).ok, false);
    const response = new Response(null, {
      headers: [
        ["set-cookie", "a=1; Path=/"],
        ["set-cookie", "cleared=; Max-Age=0"],
      ],
    });
    assert.deepEqual(cookiesFrom(response), ["a=1"]);
  } finally {
    await new Promise((done) => server.close(done));
  }
});

test("platform client registration adds the verification callback once", async () => {
  const { DatabaseSync } = await import("node:sqlite");
  const { registerClientSql } = await import("./app-stack.mjs");
  const db = new DatabaseSync(":memory:");
  db.exec(
    'CREATE TABLE "oauthClient" ("clientId" TEXT, "redirectUris" TEXT NOT NULL, "postLogoutRedirectUris" TEXT)',
  );
  db.exec(
    `INSERT INTO "oauthClient" VALUES ('sns', '["http://localhost:6178/api/auth/callback/gdgjp"]', NULL), ('pay', '[]', NULL)`,
  );
  const sql = registerClientSql("sns", "http://localhost:6165");
  db.exec(sql);
  db.exec(sql);
  const row = db.prepare('SELECT * FROM "oauthClient" WHERE "clientId" = ?').get("sns");
  assert.deepEqual(JSON.parse(row.redirectUris), [
    "http://localhost:6178/api/auth/callback/gdgjp",
    "http://localhost:6165/api/auth/callback/gdgjp",
  ]);
  assert.deepEqual(JSON.parse(row.postLogoutRedirectUris), ["http://localhost:6165/signin"]);
  assert.equal(
    db.prepare('SELECT "redirectUris" FROM "oauthClient" WHERE "clientId" = ?').get("pay")
      .redirectUris,
    "[]",
  );
});
