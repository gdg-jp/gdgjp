import { spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ensureBombadil } from "../scripts/bombadil.mjs";
import { scanForSecrets, valuesFrom, zipEntries } from "../scripts/secret-scan.mjs";
import { selfSignedCertificate } from "../src/certificate.ts";

const pkg = fileURLToPath(new URL("..", import.meta.url));
const repository = resolve(pkg, "../..");
const workflow = readFileSync(join(repository, ".github/workflows/ui-fuzz.yml"), "utf8");
const id = "dummy-access-client-id-7f3a91c2";
const secret = "dummy-access-client-secret-c0ffee5e11e5d00d";
const jwt = "eyJhbGciOiJub25lIn0.eyJzdWIiOiJmdXp6In0.dummy-signature-0123456789";
const domain = "stg.fuzz.test";
const certificate = selfSignedCertificate([`*.${domain}`, domain]);

function scanStep(text) {
  const start = text.indexOf("- name: Check the evidence for the Access token");
  return text.slice(start, text.indexOf("- name:", start + 1));
}

function scannedPaths(text) {
  return [...scanStep(text).matchAll(/^\s+"?((?:\$RUNNER_TEMP\/|packages\/)[^"\s]*)"?\s*$/gm)].map(
    (match) => match[1],
  );
}

const issuedFile = /--values "CF_Authorization=\$RUNNER_TEMP\/([^"]+)"/.exec(
  scanStep(workflow),
)?.[1];

function local(path, temp) {
  const resolved = path.replace("$RUNNER_TEMP", temp);
  return isAbsolute(resolved) ? resolved : join(repository, resolved);
}

const seen = [];
const outside = createServer((request, response) => {
  seen.push({ host: "outside", headers: request.headers });
  response.writeHead(200, { "content-type": "image/gif" }).end();
});
const slot = createServer((request, response) => {
  seen.push({ host: "slot", headers: request.headers });
  const viaCookie = (request.headers.cookie ?? "").includes(`CF_Authorization=${jwt}`);
  if (request.headers["cf-access-client-secret"] !== secret && !viaCookie) {
    response.writeHead(403, { "content-type": "text/html" }).end("<p>Access denied</p>");
    return;
  }
  const cookie = `CF_Authorization=${jwt}; Path=/; HttpOnly`;
  if (request.url === "/short") {
    response
      .writeHead(302, {
        location: `http://127.0.0.1:${outside.address().port}/pixel.gif`,
        "set-cookie": cookie,
      })
      .end();
    return;
  }
  if (request.url === "/api") {
    response.writeHead(200, { "content-type": "application/json", "set-cookie": cookie });
    response.end(JSON.stringify({ ok: true }));
    return;
  }
  response.writeHead(200, { "content-type": "text/html", "set-cookie": cookie });
  response.end(
    `<main><h1>Slot</h1><img src="/short" alt="pixel"><a href="/about">about</a><button>Toggle</button></main>
     <script>fetch("/api", { method: "POST", body: "x" }).then(() => setTimeout(() => { throw new Error("fuzz evidence boom"); }));</script>`,
  );
});

const upstreamSeen = [];
const upstream = createHttpsServer(
  { key: certificate.key, cert: certificate.cert },
  (request, response) => {
    const host = request.headers.host;
    upstreamSeen.push({ host, path: request.url, headers: request.headers });
    if (request.headers["cf-access-client-secret"] !== secret) {
      response
        .writeHead(302, { location: "https://gdgjp.cloudflareaccess.com/cdn-cgi/access/login" })
        .end();
      return;
    }
    const cookie = `CF_Authorization=${jwt}; Path=/; HttpOnly`;
    if (host === `demo.${domain}` && request.url === "/")
      return response.writeHead(302, { location: `https://accounts.${domain}/hop` }).end();
    if (host === `accounts.${domain}` && request.url === "/hop")
      return response.writeHead(303, { location: `https://demo.${domain}/home` }).end();
    if (request.url === "/short")
      return response
        .writeHead(302, {
          location: `http://127.0.0.1:${outside.address().port}/pixel.gif`,
          "set-cookie": cookie,
        })
        .end();
    if (request.url === "/api") {
      response.writeHead(200, { "content-type": "application/json", "set-cookie": cookie });
      response.end(JSON.stringify({ ok: true }));
      return;
    }
    response.writeHead(200, { "content-type": "text/html", "set-cookie": cookie });
    response.end(
      `<main><h1>Slot</h1><img src="/short" alt="pixel"><a href="/about">about</a><button>Toggle</button></main>
       <script>fetch("/api", { method: "POST", body: "x" }).then(() => setTimeout(() => { throw new Error("fuzz evidence boom"); }));</script>`,
    );
  },
);

let browser = true;
let bombadil = true;

beforeAll(async () => {
  const probe = await chromium.launch().catch((error) => {
    if (process.env.UI_PROPERTIES_REQUIRE_BROWSER) throw error;
    return null;
  });
  browser = probe !== null;
  await probe?.close();
  bombadil = await ensureBombadil().then(
    () => true,
    (error) => {
      if (process.env.UI_PROPERTIES_REQUIRE_BOMBADIL) throw error;
      return false;
    },
  );
  await new Promise((done) => outside.listen(0, "127.0.0.1", done));
  await new Promise((done) => slot.listen(0, "localhost", done));
  await new Promise((done) => upstream.listen(0, "127.0.0.1", done));
});

afterAll(async () => {
  await Promise.all(
    [slot, outside, upstream].map(
      (server) =>
        new Promise((done) => {
          server.close(done);
          server.closeAllConnections();
        }),
    ),
  );
});

function run(command, args, env, cwd = pkg) {
  return new Promise((done, reject) => {
    const child = spawn(command, args, { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => done({ code, stdout, stderr }));
  });
}

describe("staging fuzz evidence", () => {
  it("names the uploaded paths in the scan step", () => {
    expect(scannedPaths(workflow)).toEqual([
      "$RUNNER_TEMP/ui-fuzz-failures/",
      "packages/ui-properties/test-results/",
      "packages/ui-properties/playwright-report/",
      "$RUNNER_TEMP/ui-fuzz-bombadil/",
    ]);
  });

  it("keeps the Access token out of everything a failing run leaves behind", async (context) => {
    if (!browser) return context.skip();
    const temp = mkdtempSync(join(tmpdir(), "ui-fuzz-evidence-"));
    const failures = join(temp, "ui-fuzz-failures");
    const ca = join(temp, "upstream-ca.pem");
    writeFileSync(ca, certificate.cert);
    const result = await run(
      "pnpm",
      ["exec", "playwright", "test", "--config", "fuzz/playwright.config.ts"],
      {
        ...process.env,
        UI_FUZZ_TARGETS: `demo=https://demo.${domain}`,
        UI_FUZZ_DOMAIN: domain,
        UI_FUZZ_LOCAL: "1",
        UI_FUZZ_LOCAL_UPSTREAM: `127.0.0.1:${upstream.address().port}`,
        UI_FUZZ_LOCAL_CA: ca,
        CF_ACCESS_CLIENT_ID: id,
        CF_ACCESS_CLIENT_SECRET: secret,
        UI_PROPERTY_FAILURES_DIR: failures,
        UI_PROPERTY_SEEDS: "4242",
        UI_PROPERTY_STEPS: "3",
        UI_PROPERTY_MINUTES: "1",
        UI_PROPERTY_SHRINK_REPLAYS: "1",
      },
    );
    expect(result.code, result.stdout + result.stderr).not.toBe(0);
    expect(readdirSync(failures).length).toBeGreaterThan(0);
    const results = join(pkg, "test-results/fuzz");
    const traces = readdirSync(results, { recursive: true }).filter((name) =>
      String(name).endsWith("trace.zip"),
    );
    expect(traces.length).toBeGreaterThan(0);
    const records = readdirSync(failures).map((name) =>
      JSON.parse(readFileSync(join(failures, name), "utf8")),
    );
    expect(records.map((record) => record.violation.name)).toContain("no uncaught exceptions");
    expect(records.map((record) => record.violation.name)).not.toContain(
      "Access never asks the fuzzer to sign in",
    );
    expect(upstreamSeen.map((entry) => `${entry.host}${entry.path}`)).toEqual(
      expect.arrayContaining([`demo.${domain}/`, `accounts.${domain}/hop`, `demo.${domain}/home`]),
    );
    for (const entry of upstreamSeen) {
      expect(entry.headers["cf-access-client-id"]).toBe(id);
      expect(entry.headers["cf-access-client-secret"]).toBe(secret);
      expect(entry.headers.cookie ?? "").not.toContain("CF_Authorization");
    }
    const network = traces
      .flatMap((name) => zipEntries(readFileSync(join(results, String(name)))))
      .filter((entry) => entry.name.endsWith(".network"))
      .map((entry) => entry.data.toString())
      .join("\n");
    expect(network).toContain(`https://accounts.${domain}/hop`);
    expect(network).toContain(`https://demo.${domain}/home`);
    for (const entry of seen.filter((item) => item.host === "outside")) {
      expect(entry.headers["cf-access-client-secret"]).toBeUndefined();
      expect(entry.headers.cookie ?? "").not.toContain("CF_Authorization");
    }
    const paths = scannedPaths(workflow).map((path) => local(path, temp));
    expect(paths.filter((path) => existsSync(path)).length).toBeGreaterThanOrEqual(3);
    const findings = scanForSecrets(
      paths,
      {
        CF_ACCESS_CLIENT_ID: id,
        CF_ACCESS_CLIENT_SECRET: secret,
        CF_Authorization: jwt,
      },
      [
        ["stdout", result.stdout],
        ["stderr", result.stderr],
      ],
    );
    expect(findings).toEqual([]);
  }, 180_000);

  it("keeps the Access token and the JWT it issued out of what a failing Bombadil run leaves behind", async (context) => {
    if (!bombadil) return context.skip();
    expect(issuedFile).toBeTruthy();
    const temp = mkdtempSync(join(tmpdir(), "ui-fuzz-bombadil-evidence-"));
    const origin = `http://localhost:${slot.address().port}`;
    const cookies = join(temp, "ui-fuzz", "bombadil-cookies-demo");
    const values = local(`$RUNNER_TEMP/${issuedFile}`, temp);
    const environment = { ...process.env, GITHUB_ACTIONS: "", UI_PROPERTY_FAILURES_DIR: "" };
    mkdirSync(join(temp, "ui-fuzz"), { recursive: true });
    const exchange = await run(
      "node",
      [
        ".github/scripts/ui-fuzz.mjs",
        "access-cookie",
        "--url",
        `${origin}/`,
        "--local-origin",
        origin,
        "--out",
        cookies,
        "--values",
        values,
      ],
      { ...environment, CF_ACCESS_CLIENT_ID: id, CF_ACCESS_CLIENT_SECRET: secret },
      repository,
    );
    expect(exchange.code, exchange.stderr).toBe(0);
    expect(valuesFrom(values)).toEqual([jwt]);
    const line = readFileSync(cookies, "utf8").trim();
    expect(line).toBe(`CF_Authorization=${jwt}; Path=/; Secure; HttpOnly`);
    const explored = await run(
      "node",
      [
        "packages/ui-properties/scripts/bombadil.mjs",
        "explore",
        origin,
        "--time-limit",
        "40s",
        "--out",
        join(temp, "ui-fuzz-bombadil"),
      ],
      {
        ...environment,
        CF_ACCESS_CLIENT_ID: "",
        CF_ACCESS_CLIENT_SECRET: "",
        BOMBADIL_COOKIE_FILE: cookies,
        UI_PROPERTY_FAILURES_DIR: join(temp, "ui-fuzz-failures"),
      },
      repository,
    );
    expect(explored.code, explored.stdout + explored.stderr).toBe(2);
    expect(readdirSync(join(temp, "ui-fuzz-failures")).length).toBeGreaterThan(0);
    expect(readdirSync(join(temp, "ui-fuzz-bombadil")).length).toBeGreaterThan(0);
    const findings = scanForSecrets(
      scannedPaths(workflow).map((path) => local(path, temp)),
      { CF_ACCESS_CLIENT_ID: id, CF_ACCESS_CLIENT_SECRET: secret, CF_Authorization: jwt },
      [
        ["access-cookie stdout", exchange.stdout],
        ["access-cookie stderr", exchange.stderr],
        ["bombadil stdout", explored.stdout],
        ["bombadil stderr", explored.stderr],
      ],
    );
    expect(findings).toEqual([]);
  }, 180_000);
});
