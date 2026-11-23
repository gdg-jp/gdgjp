import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { timingSafeEqual } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { parse as parseToml } from "smol-toml";
import {
  COMPATIBILITY_DATE,
  DURABLE_OBJECT_APPS,
  SNAPSHOT_ENTRYPOINT,
  durableObjectWorkers,
  snapshotWorkerConfig,
  snapshotWorkerSource,
  syncDurableObjects,
  workerUrl,
} from "../../scripts/staging/durable-objects.mjs";

const ROOT = new URL("../../", import.meta.url);
const workers = [
  { app: "deck", production: "gdgjp-deck", staging: "gdgjp-deck-stg-1" },
  { app: "wiki", production: "gdgjp-wiki", staging: "gdgjp-wiki-stg-1" },
];

function wranglerToml(app) {
  return parseToml(readFileSync(new URL(`apps/${app}/wrangler.toml`, ROOT), "utf8"));
}

test("the snapshot Worker binds each app's production and slot StagingSnapshot entrypoints", () => {
  const config = snapshotWorkerConfig({ slot: "stg-1", workers });
  assert.equal(config.name, "gdgjp-staging-snapshot-stg-1");
  assert.equal(config.main, "index.mjs");
  assert.equal(config.workers_dev, true);
  assert.equal(config.preview_urls, false);
  assert.deepEqual(config.services, [
    { binding: "PROD_DECK", service: "gdgjp-deck", entrypoint: "StagingSnapshot" },
    { binding: "STG_DECK", service: "gdgjp-deck-stg-1", entrypoint: "StagingSnapshot" },
    { binding: "PROD_WIKI", service: "gdgjp-wiki", entrypoint: "StagingSnapshot" },
    { binding: "STG_WIKI", service: "gdgjp-wiki-stg-1", entrypoint: "StagingSnapshot" },
  ]);
  for (const key of ["d1_databases", "kv_namespaces", "r2_buckets", "durable_objects", "triggers"])
    assert.equal(config[key], undefined);
});

test("the snapshot Worker never imports into a Worker that is not the slot copy", () => {
  assert.throws(
    () =>
      snapshotWorkerConfig({
        slot: "stg-1",
        workers: [{ app: "deck", production: "gdgjp-deck", staging: "gdgjp-deck" }],
      }),
    /not the stg-1 copy/,
  );
  assert.throws(
    () =>
      snapshotWorkerConfig({
        slot: "stg-2",
        workers: [{ app: "deck", production: "gdgjp-deck", staging: "gdgjp-deck-stg-1" }],
      }),
    /not the stg-2 copy/,
  );
  assert.throws(
    () =>
      snapshotWorkerConfig({
        slot: "stg-1",
        workers: [{ app: "agent", production: "gdgjp-agent", staging: "gdgjp-agent-stg-1" }],
      }),
    /does not export/,
  );
  assert.throws(() => snapshotWorkerConfig({ slot: "prod", workers }), /Unknown staging slot/);
});

test("durableObjectWorkers keeps only apps with a snapshot entrypoint", () => {
  assert.deepEqual(
    durableObjectWorkers(
      [
        { app: "accounts", worker: "gdgjp-accounts" },
        { app: "mc", worker: "gdgjp-mc" },
      ],
      "stg-3",
    ),
    [{ app: "mc", production: "gdgjp-mc", staging: "gdgjp-mc-stg-3" }],
  );
});

test("every listed app exports StagingSnapshot from its Worker entry", () => {
  for (const app of DURABLE_OBJECT_APPS) {
    const toml = wranglerToml(app);
    const entry = readFileSync(
      new URL(`apps/${app}/${toml.main.replace(/^\.\//, "")}`, ROOT),
      "utf8",
    );
    assert.match(
      entry,
      new RegExp(`export \\{ ${SNAPSHOT_ENTRYPOINT} \\} from "\\./staging-snapshot";`),
      app,
    );
    assert.ok(toml.durable_objects?.bindings?.length, `${app} has Durable Objects`);
  }
});

test("the snapshot Worker uses the newest compatibility date of the apps it binds", () => {
  const dates = DURABLE_OBJECT_APPS.map((app) => wranglerToml(app).compatibility_date).sort();
  assert.equal(COMPATIBILITY_DATE, dates.at(-1));
});

test("the snapshot Worker source is a valid ES module", () => {
  const scratch = mkdtempSync(join(tmpdir(), "snapshot-worker-"));
  try {
    const file = join(scratch, "index.mjs");
    writeFileSync(file, snapshotWorkerSource());
    const result = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

async function loadWorker() {
  if (!crypto.subtle.timingSafeEqual)
    Object.defineProperty(crypto.subtle, "timingSafeEqual", {
      value: (a, b) => timingSafeEqual(a, b),
    });
  const scratch = mkdtempSync(join(tmpdir(), "snapshot-worker-"));
  const file = join(scratch, "index.mjs");
  writeFileSync(file, snapshotWorkerSource());
  try {
    return (await import(file)).default;
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

function fakeService(names, store) {
  return {
    instances: async () => names.map((name) => ({ binding: "DECK", name })),
    exportInstance: async (_binding, name) => {
      if (name === "broken") throw new Error("export failed");
      return { kv: [["key", name]], tables: [], schema: [], alarm: null };
    },
    importInstance: async (_binding, name, snapshot) => {
      store.set(name, snapshot);
    },
  };
}

test("the snapshot Worker copies one page of instances behind the token", async () => {
  const worker = await loadWorker();
  const imported = new Map();
  const env = {
    SYNC_TOKEN: "secret",
    PROD_DECK: fakeService(["a", "broken", "c"], new Map()),
    STG_DECK: fakeService([], imported),
  };
  const call = (body, token = "secret") =>
    worker.fetch(
      new Request("https://snapshot.example/sync", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      }),
      env,
    );

  assert.equal((await call({ app: "deck" }, "wrong")).status, 401);
  assert.equal((await call({ app: "unknown" })).status, 400);
  const first = await (await call({ app: "deck", offset: 0, limit: 2 })).json();
  assert.deepEqual(first, {
    app: "deck",
    total: 3,
    offset: 0,
    copied: 1,
    failed: [{ binding: "DECK", name: "broken", error: "export failed" }],
    next: 2,
  });
  const second = await (await call({ app: "deck", offset: 2, limit: 2 })).json();
  assert.equal(second.next, null);
  assert.deepEqual([...imported.keys()], ["a", "c"]);
});

test("workerUrl reads the workers.dev URL from wrangler deploy output", () => {
  assert.equal(
    workerUrl(
      "gdgjp-staging-snapshot-stg-1",
      "Uploaded\n  https://gdgjp-staging-snapshot-stg-1.gdg-jp.workers.dev\nCurrent Version ID: x",
    ),
    "https://gdgjp-staging-snapshot-stg-1.gdg-jp.workers.dev",
  );
  assert.equal(
    workerUrl("gdgjp-staging-snapshot-stg-1", "", "acct"),
    "https://gdgjp-staging-snapshot-stg-1.acct.workers.dev",
  );
  assert.throws(() => workerUrl("gdgjp-staging-snapshot-stg-1", "no url"), /workers\.dev URL/);
});

test("syncDurableObjects deploys, pages through every app, and always deletes the Worker", async () => {
  const calls = [];
  let configDir;
  const runWrangler = (args, options) => {
    calls.push({ args, options });
    if (args[0] === "deploy") {
      const configPath = args[args.indexOf("--config") + 1];
      configDir = configPath.replace(/\/wrangler\.json$/, "");
      const secrets = JSON.parse(readFileSync(args[args.indexOf("--secrets-file") + 1], "utf8"));
      assert.match(secrets.SYNC_TOKEN, /^[A-Za-z0-9_-]{43}$/);
      assert.ok(existsSync(join(configDir, "index.mjs")));
      return "https://gdgjp-staging-snapshot-stg-1.gdg-jp.workers.dev";
    }
    return "";
  };
  const requests = [];
  const fetchImpl = async (url, init) => {
    const body = JSON.parse(init.body);
    requests.push({ url, body, auth: init.headers.Authorization });
    if (requests.length === 1) return new Response("not yet", { status: 404 });
    const next = body.app === "deck" && body.offset === 0 ? 2 : null;
    return Response.json({
      app: body.app,
      total: 3,
      offset: body.offset,
      copied: 2,
      failed: [],
      next,
    });
  };

  const results = await syncDurableObjects({
    slot: "stg-1",
    workers,
    runWrangler,
    fetchImpl,
    sleep: async () => {},
  });

  assert.deepEqual(
    results.map(({ app, copied }) => [app, copied]),
    [
      ["deck", 4],
      ["wiki", 2],
    ],
  );
  assert.deepEqual(
    requests.map(({ body }) => [body.app, body.offset]),
    [
      ["deck", 0],
      ["deck", 0],
      ["deck", 2],
      ["wiki", 0],
    ],
  );
  assert.ok(
    requests.every(
      ({ url }) => url === "https://gdgjp-staging-snapshot-stg-1.gdg-jp.workers.dev/sync",
    ),
  );
  assert.equal(new Set(requests.map(({ auth }) => auth)).size, 1);
  assert.deepEqual(calls.at(-1).args.slice(0, 2), ["delete", "gdgjp-staging-snapshot-stg-1"]);
  assert.equal(existsSync(configDir), false);
});

test("syncDurableObjects deletes the Worker and reports failed objects", async () => {
  const calls = [];
  await assert.rejects(
    syncDurableObjects({
      slot: "stg-2",
      workers: [{ app: "ost", production: "gdgjp-ost", staging: "gdgjp-ost-stg-2" }],
      runWrangler: (args) => {
        calls.push(args[0]);
        return "";
      },
      accountSubdomain: "acct",
      fetchImpl: async () =>
        Response.json({
          app: "ost",
          total: 1,
          offset: 0,
          copied: 0,
          failed: [{ binding: "OST_BOARD", name: "devfest", error: "boom" }],
          next: null,
        }),
      sleep: async () => {},
    }),
    /ost OST_BOARD\/devfest: boom/,
  );
  assert.deepEqual(calls, ["deploy", "delete"]);
});
