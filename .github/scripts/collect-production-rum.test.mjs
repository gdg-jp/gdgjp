import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { aggregateEngineeringHealth } from "../../scripts/engineering-health.mjs";
import {
  GRAPHQL_ENDPOINT,
  appHosts,
  productionRumEnvelope,
  rumQuery,
  rumVariables,
  run,
} from "./collect-production-rum.mjs";

const repo = fileURLToPath(new URL("../..", import.meta.url));
const recorded = JSON.parse(
  readFileSync(new URL("./fixtures/cloudflare-rum-web-vitals.json", import.meta.url), "utf8"),
);
const since = "2026-10-25T00:00:00Z";
const until = "2026-11-24T00:00:00Z";
const collectedAt = "2026-11-24T00:05:00.000Z";
const hosts = new Map([
  ["wiki.gdgs.jp", "wiki"],
  ["gdgs.jp", "website"],
]);

test("the query aggregates by host only, excludes bots, and keeps the requested window", () => {
  assert.match(rumQuery, /dimensions \{ requestHost \}/);
  assert.doesNotMatch(rumQuery, /requestPath|refererPath|userAgent|countryName|Element/);
  assert.deepEqual(rumVariables({ accountTag: "account", since, until }), {
    accountTag: "account",
    filter: { datetime_geq: since, datetime_leq: until, bot: 0 },
  });
  assert.deepEqual(
    rumVariables({ accountTag: "account", since, until, siteTags: ["a"] }).filter.siteTag_in,
    ["a"],
  );
});

test("production hosts come from each app's production Wrangler routes and APP_URL", (t) => {
  const real = appHosts(repo);
  assert.equal(real.get("wiki.gdgs.jp"), "wiki");
  assert.equal(real.get("accounts.gdgs.jp"), "accounts");
  assert.equal(real.get("gdgs.jp"), "website");
  const root = mkdtempSync(join(tmpdir(), "production-rum-hosts-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, "apps/one"), { recursive: true });
  mkdirSync(join(root, "apps/two"), { recursive: true });
  writeFileSync(
    join(root, "apps/one/wrangler.toml"),
    [
      'APP_URL = "http://localhost:5173"',
      '# pattern = "commented.gdgs.jp/*"',
      "[[routes]]",
      'pattern = "one.gdgs.jp/*"',
      "[env.staging]",
      'routes = [{ pattern = "one-staging.gdgs.jp", custom_domain = true }]',
    ].join("\n"),
  );
  writeFileSync(
    join(root, "apps/two/wrangler.jsonc"),
    '{ "vars": { "APP_URL": "https://two.gdgs.jp" } }',
  );
  assert.deepEqual(
    [...appHosts(root)],
    [
      ["one.gdgs.jp", "one"],
      ["two.gdgs.jp", "two"],
    ],
  );
  writeFileSync(join(root, "apps/two/wrangler.toml"), 'pattern = "one.gdgs.jp"');
  assert.throws(() => appHosts(root), /claimed by one and two/);
});

test("recorded web vitals become per-app percentiles in milliseconds without staging hosts", () => {
  const envelope = productionRumEnvelope({ response: recorded, since, until, collectedAt, hosts });
  assert.equal(envelope.kind, "production-rum");
  assert.equal(envelope.format, "aggregate");
  assert.deepEqual(envelope.window, { since, until, inclusive: true });
  assert.deepEqual(
    envelope.apps.map((entry) => [entry.app, entry.host, entry.pageViews]),
    [
      ["website", "gdgs.jp", 96],
      ["wiki", "wiki.gdgs.jp", 1840],
    ],
  );
  assert.equal(envelope.excludedHostCount, 1);
  assert.equal(envelope.excludedPageViews, 12);
  const wiki = envelope.apps[1].metrics;
  assert.deepEqual(wiki.lcpMs, { sampleCount: 1702, p50: 1104, p75: 1712, p90: 2650, p99: 5210 });
  assert.deepEqual(wiki.cls, { sampleCount: 1755, p50: 0.01, p75: 0.04, p90: 0.11, p99: 0.32 });
  assert.equal(wiki.ttfbMs.p75, 311);
  assert.deepEqual(envelope.apps[0].metrics.inpMs, {
    sampleCount: 0,
    p50: null,
    p75: null,
    p90: null,
    p99: null,
  });
  assert.doesNotMatch(JSON.stringify(envelope), /staging|\?|requestPath/);
});

test("the collected envelope sits beside throughput and reverts for the same window", () => {
  const envelope = productionRumEnvelope({ response: recorded, since, until, collectedAt, hosts });
  const commit = (letter, subject, paths) => ({
    sha: letter.repeat(40),
    committedAt: "2026-11-20T00:00:00Z",
    subject,
    paths,
  });
  const base = {
    since,
    until,
    now: "2026-11-24T01:00:00Z",
    commits: [
      commit("a", "feat(wiki): add search", ["apps/wiki/app/search.ts", "packages/x/a.ts"]),
      commit("b", 'Revert "feat(wiki): add search"', ["apps/wiki/app/search.ts"]),
      commit("c", "feat(ost): add board", ["apps/ost/app/board.ts"]),
    ],
    deployRuns: {
      collectedAt,
      source: "fixture",
      total_count: 1,
      workflow_runs: [
        { id: 1, status: "completed", conclusion: "success", created_at: "2026-11-21T00:00:00Z" },
      ],
    },
    productionRum: envelope,
  };
  const report = aggregateEngineeringHealth(base);
  const side = report.deliveryAndPerformance;
  assert.match(side.causality, /^Not inferred/);
  assert.deepEqual(side.throughput.commits, 3);
  assert.equal(side.throughput.explicitReverts, 1);
  assert.equal(side.throughput.deployAttempts, 1);
  assert.equal(side.production.windowMatchesReport, true);
  assert.deepEqual(
    side.apps.map((row) => [row.app, row.commits, row.explicitReverts, row.production?.length]),
    [
      ["ost", 1, 0, undefined],
      ["website", 0, 0, 1],
      ["wiki", 2, 1, 1],
    ],
  );
  assert.deepEqual(side.apps[2].production[0].lcpMs, { p75: 1712, sampleCount: 1702 });
  assert.equal(report.productionRum.status, "available");
  assert.ok(!report.gaps.some((gap) => gap.startsWith("productionRum")));

  const shifted = aggregateEngineeringHealth({ ...base, since: "2026-10-26T00:00:00Z" });
  assert.equal(shifted.productionRum.windowMatchesReport, false);
  assert.ok(shifted.gaps.includes("productionRum: window differs from the report window"));
  assert.ok(shifted.deliveryAndPerformance.apps.every((row) => row.production === null));

  const missing = aggregateEngineeringHealth({ ...base, productionRum: undefined });
  assert.equal(missing.deliveryAndPerformance.production.basis, "unavailable");
  assert.ok(missing.deliveryAndPerformance.apps.every((row) => row.production === null));

  const withoutPaths = aggregateEngineeringHealth({
    ...base,
    commits: base.commits.map(({ paths, ...rest }) => rest),
  });
  assert.equal(
    withoutPaths.deliveryAndPerformance.apps.find((row) => row.app === "wiki").commits,
    null,
  );
});

test("aggregate production RUM rejects local, synthetic, relabeled, or impossible values", () => {
  const envelope = productionRumEnvelope({ response: recorded, since, until, collectedAt, hosts });
  const check = (mutate) => {
    const copy = structuredClone(envelope);
    mutate(copy);
    return () =>
      aggregateEngineeringHealth({
        since,
        until,
        now: "2026-11-24T01:00:00Z",
        commits: [],
        productionRum: copy,
      });
  };
  for (const mutate of [
    (value) => {
      value.apps[0].host = "localhost";
    },
    (value) => {
      value.apps[0].host = "127.0.0.1";
    },
    (value) => {
      value.apps[0].host = "wiki.localhost";
    },
    (value) => {
      value.apps[0].synthetic = true;
    },
    (value) => {
      value.synthetic = true;
    },
    (value) => {
      value.kind = "synthetic-navigation";
    },
    (value) => {
      value.apps[0].metrics.inpMs.p75 = 12;
    },
    (value) => {
      value.apps[1].metrics.lcpMs.p75 = -1;
    },
    (value) => {
      value.window = undefined;
    },
  ])
    assert.throws(check(mutate));
});

test("the collector posts with a bearer token and a non-Python client, then writes the envelope", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "production-rum-run-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const output = join(root, "out/production-rum.json");
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push([url, init]);
    return { ok: true, status: 200, json: async () => recorded };
  };
  const env = {
    CLOUDFLARE_RUM_API_TOKEN: "fixture-token",
    CLOUDFLARE_RUM_ACCOUNT_ID: "fixture-account",
  };
  const args = ["--since", since, "--until", until, "--output", output, "--repo", repo];
  const envelope = await run(args, { env, fetchImpl, now: () => new Date(collectedAt) });
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], GRAPHQL_ENDPOINT);
  assert.equal(calls[0][1].headers.authorization, "Bearer fixture-token");
  assert.doesNotMatch(calls[0][1].headers["user-agent"], /python/i);
  const body = JSON.parse(calls[0][1].body);
  assert.equal(body.variables.accountTag, "fixture-account");
  assert.deepEqual(JSON.parse(readFileSync(output, "utf8")), envelope);
  assert.doesNotMatch(readFileSync(output, "utf8"), /fixture-token|fixture-account/);
  assert.equal(envelope.apps.find((entry) => entry.host === "wiki.gdgs.jp").app, "wiki");

  const failed = join(root, "failed.json");
  const failing = ["--since", since, "--until", until, "--output", failed, "--repo", repo];
  await assert.rejects(run(failing, { env: {}, fetchImpl }), /CLOUDFLARE_RUM_API_TOKEN/);
  await assert.rejects(
    run(failing, { env, fetchImpl: async () => ({ ok: false, status: 403 }) }),
    /HTTP 403/,
  );
  await assert.rejects(
    run(failing, {
      env,
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        json: async () => ({ data: null, errors: [{ message: "not authorized" }] }),
      }),
    }),
    /not authorized/,
  );
  await assert.rejects(
    run(["--since", "yesterday", "--until", until, "--output", failed], { env, fetchImpl }),
    /UTC ISO/,
  );
  assert.equal(existsSync(failed), false);
});
