import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";
import { applications, identityLogin, requiredPorts, selectApplications } from "./apps.mjs";
import {
  checkApplication,
  doctorApplications,
  parseArguments,
  probePage,
  readPlatform,
  signInFixture,
} from "./verify-apps.mjs";

describe("application definitions", () => {
  test("every application has a distinct local port", () => {
    const ports = requiredPorts(Object.keys(applications));
    assert.equal(new Set(ports).size, ports.length);
    for (const name of Object.keys(applications)) {
      assert.ok(applications[name].port >= 6100 && applications[name].port <= 6199, name);
    }
  });

  test("every gated application has an identity that proves sign-in", () => {
    for (const [name, definition] of Object.entries(applications)) {
      assert.ok(definition.anonymous.path.startsWith("/"), name);
      if (definition.gated) assert.ok(Object.keys(definition.identities).length > 0, name);
      for (const [identity, value] of Object.entries(definition.identities)) {
        assert.ok(value.probe.text || value.probe.redirect, `${name} ${identity}`);
      }
    }
  });

  test("fixture logins name the user, every chapter, and the probe page", () => {
    const url = new URL(identityLogin("ost", "outsider"), "http://localhost");
    assert.equal(url.pathname, "/dev/login");
    assert.equal(url.searchParams.get("as"), "verify-outsider");
    assert.deepEqual(url.searchParams.getAll("chapter"), ["2:other-chapter"]);
    assert.equal(url.searchParams.get("return_to"), "/");
  });
});

describe("arguments", () => {
  test("selects applications once and in order", () => {
    assert.deepEqual(selectApplications("ost, screen,ost"), ["ost", "screen"]);
    const options = parseArguments(["--app", "screen", "--serve"]);
    assert.equal(options.mode, "serve");
    assert.deepEqual(options.apps, ["screen"]);
  });

  test("rejects unknown applications, missing selections, and unknown flags", () => {
    assert.throws(() => parseArguments(["--app", "nope"]), /Unknown application nope/);
    assert.throws(() => parseArguments(["--doctor"]), /Select at least one application/);
    assert.throws(() => parseArguments(["--app", "ost", "--fast"]), /Unknown argument/);
  });
});

describe("doctor and platform", () => {
  let scratch;
  before(() => {
    scratch = mkdtempSync(join(tmpdir(), "verify-apps-test-"));
  });
  after(() => rmSync(scratch, { recursive: true, force: true }));

  test("doctor names every missing prerequisite", async () => {
    await assert.rejects(
      doctorApplications({ source: scratch, apps: ["ost"] }),
      /Missing prerequisite: .*apps\/ost\/package.json/,
    );
  });

  test("a platform record must point at a live scratch registry", () => {
    const ready = join(scratch, "ready.json");
    writeFileSync(
      ready,
      JSON.stringify({ scratch, origins: { accounts: "http://localhost:6173" } }),
    );
    assert.throws(() => readPlatform(ready), /Platform stack is not running/);
    mkdirSync(join(scratch, ".e2e-registry"));
    assert.deepEqual(readPlatform(ready), {
      readyPath: ready,
      accounts: "http://localhost:6173",
      registry: join(scratch, ".e2e-registry"),
      accountsDirectory: join(scratch, "apps/accounts"),
    });
    assert.equal(readPlatform(undefined), null);
  });
});

function fakeOst({ gate = true } = {}) {
  return createServer((request, response) => {
    const url = new URL(request.url, "http://localhost");
    const session = /gdgjp-ost\.session=(\w+)/.exec(request.headers.cookie ?? "")?.[1];
    if (url.pathname === "/dev/login") {
      const as = url.searchParams.get("as");
      response.writeHead(302, {
        location: url.searchParams.get("return_to"),
        "set-cookie": [`gdgjp-ost.session=${as.replace(/\W/g, "")}; Path=/; HttpOnly`],
      });
      return response.end();
    }
    if (url.pathname === "/verify-ost/screen" && gate && !session) {
      response.writeHead(302, { location: "/signin?return_to=%2Fverify-ost%2Fscreen" });
      return response.end();
    }
    if (url.pathname === "/verify-ost/screen") return response.end("screen");
    if (url.pathname === "/verify-ost") return response.end("<h1>Verify OST</h1>");
    if (url.pathname === "/" && session === "verifyowner") return response.end("Verify OST");
    if (url.pathname === "/" && session === "verifyoutsider") return response.end("other-chapter");
    response.writeHead(302, { location: "/signin" });
    response.end();
  });
}

async function listen(server) {
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  return `http://127.0.0.1:${server.address().port}`;
}

describe("readiness probe", () => {
  test("requires the expected text and records its absence", async () => {
    const server = fakeOst();
    const base = await listen(server);
    try {
      const found = await probePage(base, { path: "/verify-ost", text: "Verify OST" });
      assert.equal(found.ok, true);
      const missing = await probePage(base, { path: "/verify-ost", text: "Other" });
      assert.equal(missing.ok, false);
      assert.equal(missing.expectedTextFound, false);
      const redirect = await probePage(base, { path: "/", redirect: "/signin" });
      assert.equal(redirect.ok, true);
    } finally {
      server.close();
    }
  });

  test("signs in each fixture and proves the identity sees its own page", async () => {
    const server = fakeOst();
    const base = await listen(server);
    try {
      const cookie = await signInFixture(base, identityLogin("ost", "owner"));
      assert.equal(cookie, "gdgjp-ost.session=verifyowner");
      const saved = [];
      const checks = await checkApplication("ost", base, {
        save: (label) => saved.push(label),
      });
      assert.equal(checks.gated.ok, true);
      assert.equal(checks.identities.owner.ok, true);
      assert.equal(checks.identities.outsider.ok, true);
      assert.deepEqual(saved, ["ost-anonymous", "ost-gated", "ost-owner", "ost-outsider"]);
    } finally {
      server.close();
    }
  });

  test("fails when an admin page is not behind sign-in", async () => {
    const server = fakeOst({ gate: false });
    const base = await listen(server);
    try {
      await assert.rejects(checkApplication("ost", base), /did not gate/);
    } finally {
      server.close();
    }
  });

  test("fails when fixture sign-in sets no session", async () => {
    const server = createServer((_, response) => response.end("ok"));
    const base = await listen(server);
    try {
      await assert.rejects(signInFixture(base, "/dev/login?as=x"), /Fixture sign-in failed/);
    } finally {
      server.close();
    }
  });
});

describe("feature maps", () => {
  test("every application has mapped journeys with unique IDs", async () => {
    const { mapJourneys } = await import("./coverage.mjs");
    const journeys = mapJourneys();
    assert.equal(new Set(journeys.map(({ id }) => id)).size, journeys.length);
    for (const name of Object.keys(applications)) {
      assert.ok(
        journeys.some((journey) => journey.app === name && journey.inMap),
        `${name} has no in-map journey`,
      );
    }
  });
});

describe("platform sign-in probe", () => {
  test("follows the app's own redirects to the Accounts authorize endpoint", async () => {
    let accounts = "";
    const server = createServer((request, response) => {
      const url = new URL(request.url, "http://localhost");
      if (url.pathname === "/signin") response.writeHead(302, { location: "/api/auth/signin" });
      else if (url.pathname === "/api/auth/signin")
        response.writeHead(302, {
          location: `${accounts}/api/auth/oauth2/authorize?client_id=ost`,
        });
      else return fakeOst().emit("request", request, response);
      response.end();
    });
    const base = await listen(server);
    accounts = "http://127.0.0.1:1";
    try {
      const checks = await checkApplication("ost", base, { platform: { accounts } });
      assert.equal(checks.oidc.ok, true);
      assert.deepEqual(
        checks.oidc.hops.map(({ path }) => path),
        ["/signin", "/api/auth/signin"],
      );
      await assert.rejects(
        checkApplication("ost", base, { platform: { accounts: "http://127.0.0.1:2" } }),
        /does not reach/,
      );
    } finally {
      server.close();
    }
  });
});
