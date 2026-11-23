import assert from "node:assert/strict";
import test from "node:test";
import { applicationBody } from "../../scripts/staging/access.mjs";
import {
  classifySchema,
  composeImport,
  dependencyOrder,
  issuerColumns,
  issuerRewriteSql,
  oauthRedirectRewriteSql,
  orderInserts,
  orderSelfReferences,
  parseInsert,
  planInsertOrder,
  requiredResources,
  rewriteUrls,
  rewriteWorkerConfig,
  slotFromLabel,
  splitStatements,
  sqlLiteral,
  stagingHost,
  stagingName,
  withoutWorkerTargets,
  workerTargets,
} from "../../scripts/staging/lib.mjs";
import { selectTargets } from "../../scripts/staging/select.mjs";
import {
  RELYING_PARTY_APPS,
  e2eEnvironment,
  parseJsonc,
  stagingApps,
} from "../../scripts/staging/staging.mjs";

test("labels select exactly the three staging slots", () => {
  assert.equal(slotFromLabel("E-deploy-stg1"), "stg-1");
  assert.equal(slotFromLabel("E-deploy-stg3"), "stg-3");
  assert.equal(slotFromLabel("E-deploy-stg4"), null);
  assert.equal(slotFromLabel("E-deploy-stg1-extra"), null);
  assert.equal(slotFromLabel("deploy-stg-1"), null);
  assert.equal(slotFromLabel(undefined), null);
});

test("staging hosts nest under the slot inside the gdgs.jp zone", () => {
  assert.equal(stagingHost("accounts.gdgs.jp", "stg-2"), "accounts.stg2.gdgs.jp");
  assert.equal(stagingHost("gdgs.jp", "stg-1"), "stg1.gdgs.jp");
  assert.equal(stagingHost("api.webmcp.gdgs.jp", "stg-1"), "api.webmcp.stg1.gdgs.jp");
  assert.equal(stagingHost("example.com", "stg-1"), "example.com");
  assert.throws(() => stagingHost("accounts.gdgs.jp", "prod"), /Unknown staging slot/);
});

test("URL rewriting keeps protocol identifiers and other domains", () => {
  assert.equal(
    rewriteUrls(
      "https://url.gdgs.jp/api/auth/callback/gdgjp,https://go.gdgs.jp/x https://gdgs.jp",
      "stg-1",
    ),
    "https://url.stg1.gdgs.jp/api/auth/callback/gdgjp,https://go.stg1.gdgs.jp/x https://stg1.gdgs.jp",
  );
  assert.equal(
    rewriteUrls("https://gdgs.jp/scopes/chapters", "stg-1"),
    "https://gdgs.jp/scopes/chapters",
  );
  assert.equal(
    rewriteUrls("https://gdgs.jp/claims/is_admin", "stg-1"),
    "https://gdgs.jp/claims/is_admin",
  );
  assert.equal(
    rewriteUrls("https://api.x.com/2/oauth2/token", "stg-1"),
    "https://api.x.com/2/oauth2/token",
  );
  assert.equal(
    rewriteUrls("https://gdgs.jp.evil.example", "stg-1"),
    "https://gdgs.jp.evil.example",
  );
  assert.equal(rewriteUrls("https://notgdgs.jp", "stg-1"), "https://notgdgs.jp");
});

test("staging names refuse to double-suffix a staging resource", () => {
  assert.equal(stagingName("gdgjp-wiki-db", "stg-1"), "gdgjp-wiki-db-stg-1");
  assert.throws(() => stagingName("gdgjp-wiki-db-stg-1", "stg-1"), /already/);
});

const resources = {
  d1: { "gdgjp-wiki-db-stg-1": "staging-d1" },
  kv: { "gdgjp-mcp-oauth-stg-1": "staging-kv" },
  kvTitles: { "prod-kv": "gdgjp-mcp-oauth" },
};

test("worker configs point every stateful binding at slot resources", () => {
  const output = rewriteWorkerConfig(
    {
      name: "gdgjp-wiki",
      main: "index.js",
      keep_vars: true,
      vars: { APP_URL: "https://wiki.gdgs.jp", SCOPE: "https://gdgs.jp/scopes/chapters" },
      routes: [{ pattern: "wiki.gdgs.jp/*", zone_name: "gdgs.jp" }],
      triggers: { crons: ["0 * * * *"] },
      d1_databases: [
        {
          binding: "DB",
          database_name: "gdgjp-wiki-db",
          database_id: "prod-d1",
          migrations_dir: "../../migrations",
        },
      ],
      kv_namespaces: [{ binding: "KV", id: "prod-kv" }],
      r2_buckets: [{ binding: "BUCKET", bucket_name: "gdgjp-wiki-storage" }],
      queues: {
        producers: [{ binding: "Q", queue: "gdgjp-wiki-source-fetch" }],
        consumers: [{ queue: "gdgjp-wiki-source-fetch", max_batch_size: 1 }],
      },
      services: [{ binding: "ACCOUNTS", service: "gdgjp-accounts", remote: true }],
      durable_objects: { bindings: [{ name: "COLLAB_DO", class_name: "CollabDurableObject" }] },
      workflows: [{ name: "gdgjp-wiki-generation", binding: "W", class_name: "Phase" }],
      ai_search_namespaces: [{ binding: "KNOWLEDGE", namespace: "gdgjp-knowledge" }],
      analytics_engine_datasets: [{ binding: "CLICKS_AE" }],
      vectorize: [],
      cloudchamber: {},
    },
    {
      slot: "stg-1",
      hosts: ["wiki.gdgs.jp"],
      resources,
      workerNames: new Set(["gdgjp-wiki", "gdgjp-accounts"]),
      extraVars: { AI_GATEWAY_BASE_URL: "https://gateway.example", APP_URL: "ignored" },
      varOverrides: { GOOGLE_CLIENT_ID: "staging-client" },
    },
  );
  assert.equal(output.name, "gdgjp-wiki-stg-1");
  assert.deepEqual(output.vars, {
    AI_GATEWAY_BASE_URL: "https://gateway.example",
    APP_URL: "https://wiki.stg1.gdgs.jp",
    SCOPE: "https://gdgs.jp/scopes/chapters",
    GOOGLE_CLIENT_ID: "staging-client",
    STAGING_SLOT: "stg-1",
  });
  assert.deepEqual(output.routes, [{ pattern: "wiki.stg1.gdgs.jp", custom_domain: true }]);
  assert.deepEqual(output.triggers, { crons: ["0 * * * *"] });
  assert.equal(output.workers_dev, false);
  assert.deepEqual(output.d1_databases, [
    {
      binding: "DB",
      database_name: "gdgjp-wiki-db-stg-1",
      database_id: "staging-d1",
      migrations_dir: "../../migrations",
    },
  ]);
  assert.deepEqual(output.kv_namespaces, [{ binding: "KV", id: "staging-kv" }]);
  assert.equal(output.r2_buckets[0].bucket_name, "gdgjp-wiki-storage-stg-1");
  assert.equal(output.queues.producers[0].queue, "gdgjp-wiki-source-fetch-stg-1");
  assert.equal(output.queues.consumers[0].queue, "gdgjp-wiki-source-fetch-stg-1");
  assert.deepEqual(output.services, [{ binding: "ACCOUNTS", service: "gdgjp-accounts-stg-1" }]);
  assert.equal(output.workflows[0].name, "gdgjp-wiki-generation-stg-1");
  assert.equal(output.ai_search_namespaces[0].namespace, "gdgjp-knowledge-stg-1");
  assert.equal(output.analytics_engine_datasets[0].dataset, "CLICKS_AE-stg-1");
  assert.equal(output.keep_vars, true);
  assert.equal(JSON.stringify(output).includes("prod-"), false);
});

test("unknown non-empty bindings stop the deploy instead of sharing production state", () => {
  assert.throws(
    () =>
      rewriteWorkerConfig(
        { name: "gdgjp-x", services: [{ binding: "R", service: "gdgjp-discord-relay" }] },
        { slot: "stg-1", hosts: ["x.gdgs.jp"], resources, workerNames: new Set(["gdgjp-x"]) },
      ),
    /gdgjp-discord-relay, which has no staging copy, would reach production/,
  );
  assert.throws(
    () =>
      rewriteWorkerConfig(
        { name: "gdgjp-x", hyperdrive: [{ binding: "H", id: "prod" }] },
        { slot: "stg-1", hosts: ["x.gdgs.jp"], resources, workerNames: new Set() },
      ),
    /does not know how to isolate "hyperdrive"/,
  );
  assert.throws(
    () =>
      rewriteWorkerConfig(
        { name: "gdgjp-x", d1_databases: [{ database_name: "missing", database_id: "p" }] },
        { slot: "stg-1", hosts: ["x.gdgs.jp"], resources, workerNames: new Set() },
      ),
    /missing-stg-1 does not exist/,
  );
});

test("required resources list every slot-owned name a config needs", () => {
  assert.deepEqual(
    requiredResources(
      {
        d1_databases: [{ database_name: "a-db" }],
        kv_namespaces: [{ id: "kv1" }],
        r2_buckets: [{ bucket_name: "b" }],
        queues: {
          producers: [{ queue: "q" }],
          consumers: [{ queue: "q", dead_letter_queue: "dlq" }],
        },
        ai_search_namespaces: [{ namespace: "n" }],
      },
      "stg-2",
    ),
    {
      d1: ["a-db-stg-2"],
      kv: ["kv1"],
      r2: ["b-stg-2"],
      queues: ["q-stg-2", "dlq-stg-2"],
      aiSearchNamespaces: ["n-stg-2"],
    },
  );
});

test("imports recreate tables before data and virtual tables, triggers last", () => {
  const schema = classifySchema([
    { type: "table", name: "pages", sql: "CREATE TABLE pages (id TEXT)" },
    { type: "table", name: "d1_migrations", sql: "CREATE TABLE d1_migrations (id INTEGER)" },
    { type: "table", name: "sqlite_sequence", sql: "CREATE TABLE sqlite_sequence(name,seq)" },
    { type: "table", name: "_cf_KV", sql: "CREATE TABLE _cf_KV (key TEXT)" },
    {
      type: "table",
      name: "pages_fts",
      sql: "CREATE VIRTUAL TABLE pages_fts USING fts5(page_id UNINDEXED, title)",
    },
    { type: "table", name: "pages_fts_data", sql: "CREATE TABLE 'pages_fts_data'(id)" },
    { type: "table", name: "pages_fts_config", sql: "CREATE TABLE 'pages_fts_config'(k)" },
    { type: "index", name: "sqlite_autoindex_pages_1", sql: null },
    { type: "index", name: "pages_id", sql: "CREATE INDEX pages_id ON pages(id)" },
    {
      type: "trigger",
      name: "pages_fts_insert",
      sql: "CREATE TRIGGER pages_fts_insert AFTER INSERT ON pages BEGIN SELECT 1; END",
    },
  ]);
  assert.deepEqual(
    schema.tables.map(({ name }) => name),
    ["pages", "d1_migrations"],
  );
  assert.deepEqual(
    schema.virtualTables.map(({ name }) => name),
    ["pages_fts"],
  );
  const sql = composeImport({
    schema,
    data: "PRAGMA defer_foreign_keys=TRUE;\nINSERT INTO \"pages\" VALUES('p1');",
    virtualRows: { pages_fts: [{ rowid: 7, page_id: "p1", title: "It's" }] },
  });
  const order = [
    "PRAGMA defer_foreign_keys=TRUE;",
    "CREATE TABLE pages",
    "CREATE TABLE d1_migrations",
    "CREATE INDEX pages_id",
    'INSERT INTO "pages"',
    "CREATE VIRTUAL TABLE pages_fts",
    `INSERT INTO "pages_fts" ("rowid", "page_id", "title") VALUES (7, 'p1', 'It''s');`,
    "CREATE TRIGGER pages_fts_insert",
  ].map((fragment) => sql.indexOf(fragment));
  assert.ok(
    order.every((index) => index >= 0),
    sql,
  );
  assert.deepEqual(
    [...order].sort((a, b) => a - b),
    order,
  );
  assert.equal(sql.match(/PRAGMA defer_foreign_keys/g).length, 1);
});

test("SQL literals encode text, numbers, null and blobs", () => {
  assert.equal(sqlLiteral(null), "NULL");
  assert.equal(sqlLiteral(3), "3");
  assert.equal(sqlLiteral("a'b"), "'a''b'");
  assert.equal(sqlLiteral([0, 255]), "X'00ff'");
  assert.throws(() => sqlLiteral(Number.NaN));
});

test("copied OAuth clients redirect to the slot's relying parties", () => {
  const sql = oauthRedirectRewriteSql("stg-3");
  assert.match(sql, /replace\(replace\("redirectUris", '\.gdgs\.jp', '\.stg3\.gdgs\.jp'\)/);
  assert.match(sql, /'\/\/gdgs\.jp', '\/\/stg3\.gdgs\.jp'/);
  assert.match(sql, /^UPDATE "oauthClient"/);
});

test("staging covers every Cloudflare deploy target, including live-checkin", () => {
  const apps = stagingApps();
  const names = apps.map(({ app }) => app);
  assert.ok(names.includes("accounts"));
  assert.ok(names.includes("live-checkin"));
  assert.equal(apps.find(({ app }) => app === "live-checkin").worker, "gdgjp-live-checkin");
  assert.ok(!names.includes("tinyurl-gateway"));
  for (const app of RELYING_PARTY_APPS) assert.ok(names.includes(app), app);
  const environment = e2eEnvironment("stg-2");
  assert.equal(environment.E2E_ACCOUNTS_URL, "https://accounts.stg2.gdgs.jp");
  assert.equal(environment.E2E_ACCOUNTS_D1, "remote:gdgjp-accounts-db-stg-2");
  assert.ok(environment.E2E_RP_URLS.split(",").includes("https://url.stg2.gdgs.jp"));
  assert.ok(environment.E2E_RP_URLS.split(",").every((url) => url.endsWith(".stg2.gdgs.jp")));
});

test("JSONC configs keep URLs inside strings while dropping comments", () => {
  assert.deepEqual(
    parseJsonc('{\n  // note\n  "a": "https://x.example/y", /* c */ "b": [1, 2,],\n}'),
    { a: "https://x.example/y", b: [1, 2] },
  );
});

const repo = "gdg-jp/gdgjp";
const base = { repo, mainSha: "main-sha" };

test("a deploy label claims its slot for the PR head", () => {
  assert.deepEqual(
    selectTargets({
      ...base,
      event: "pull_request",
      action: "labeled",
      label: "E-deploy-stg2",
      pr: 12,
      headSha: "head",
      headRepo: repo,
    }),
    [{ slot: "stg-2", ref: "head", pr: "12" }],
  );
  for (const label of ["bug", "E-deploy-stg9"])
    assert.deepEqual(
      selectTargets({
        ...base,
        event: "pull_request",
        action: "labeled",
        label,
        pr: 1,
        headSha: "h",
        headRepo: repo,
      }),
      [],
    );
  assert.deepEqual(
    selectTargets({
      ...base,
      event: "pull_request",
      action: "labeled",
      label: "E-deploy-stg1",
      pr: 3,
      headSha: "h",
      headRepo: "someone/fork",
    }),
    [],
  );
});

test("slots return to main when their PR closes and follow main while idle", () => {
  const current = { "stg-1": { sha: "a", pr: "7" }, "stg-2": { sha: "b", pr: "" } };
  assert.deepEqual(
    selectTargets({ ...base, event: "pull_request", action: "closed", pr: 7, current }),
    [{ slot: "stg-1", ref: "main-sha", pr: "" }],
  );
  assert.deepEqual(
    selectTargets({ ...base, event: "push", current }).map(({ slot }) => slot),
    ["stg-2", "stg-3"],
  );
  assert.deepEqual(selectTargets({ ...base, event: "schedule", current }), [
    { slot: "stg-1", ref: "a", pr: "7" },
    { slot: "stg-2", ref: "main-sha", pr: "" },
    { slot: "stg-3", ref: "main-sha", pr: "" },
  ]);
});

test("first deploys drop bindings to Workers that do not exist yet", () => {
  const config = {
    name: "gdgjp-wiki-stg-1",
    services: [
      { binding: "ACCOUNTS", service: "gdgjp-accounts-stg-1" },
      { binding: "AGENT", service: "gdgjp-agent-stg-1" },
    ],
    durable_objects: {
      bindings: [
        { name: "COLLAB_DO", class_name: "Collab" },
        { name: "REMOTE", class_name: "R", script_name: "gdgjp-agent-stg-1" },
      ],
    },
    workflows: [{ name: "w", binding: "W", class_name: "C" }],
  };
  assert.deepEqual(workerTargets(config), ["gdgjp-accounts-stg-1", "gdgjp-agent-stg-1"]);
  const bootstrap = withoutWorkerTargets(config, ["gdgjp-agent-stg-1"]);
  assert.deepEqual(
    bootstrap.services.map(({ service }) => service),
    ["gdgjp-accounts-stg-1"],
  );
  assert.deepEqual(
    bootstrap.durable_objects.bindings.map(({ name }) => name),
    ["COLLAB_DO"],
  );
  assert.equal(bootstrap.workflows.length, 1);
});

test("staging turns off notifications that would reach people in copied data", () => {
  const meet = rewriteWorkerConfig(
    { name: "gdgjp-meet", vars: { CALENDAR_SEND_UPDATES: "all" } },
    { slot: "stg-1", hosts: ["meet.gdgs.jp"], resources, workerNames: new Set() },
  );
  assert.equal(meet.vars.CALENDAR_SEND_UPDATES, "none");
  const accounts = rewriteWorkerConfig(
    { name: "gdgjp-accounts", vars: { EMAIL_FROM: "GDG Japan <noreply@gdgs.jp>" } },
    { slot: "stg-1", hosts: ["accounts.gdgs.jp"], resources, workerNames: new Set() },
  );
  assert.match(accounts.vars.EMAIL_FROM, /onboarding@resend\.dev/);
});

test("imports insert parent rows before the rows that reference them", () => {
  assert.deepEqual(
    dependencyOrder(["link_tags", "tags", "links", "folders"], {
      link_tags: ["tags", "links"],
      links: ["folders"],
      folders: ["folders"],
    }),
    ["tags", "folders", "links", "link_tags"],
  );
  const data = [
    "PRAGMA defer_foreign_keys=TRUE;",
    `INSERT INTO "link_tags" VALUES('l1','t1');`,
    `INSERT INTO "links" VALUES('l1','line one;`,
    `line two ''quoted''');`,
    `INSERT INTO "tags" VALUES('t1');`,
    `INSERT INTO "sqlite_sequence" VALUES('links',3);`,
  ].join("\n");
  const ordered = splitStatements(orderInserts(data, ["tags", "links", "link_tags"]));
  assert.deepEqual(
    ordered.map((statement) => /INTO "([^"]+)"/.exec(statement)[1]),
    ["tags", "links", "link_tags", "sqlite_sequence"],
  );
  assert.match(ordered[1], /line one;\nline two ''quoted''/);
});

test("self-referencing rows are inserted parent first", () => {
  const rows = [
    `INSERT INTO "items" ("id","parent_id","note") VALUES(3,2,'c, (x)');`,
    `INSERT INTO "items" ("id","parent_id","note") VALUES(2,1,'it''s');`,
    `INSERT INTO "items" ("id","parent_id","note") VALUES(1,NULL,'root');`,
    `INSERT INTO "items" ("id","parent_id","note") VALUES(4,NULL,'other');`,
  ];
  assert.deepEqual(
    orderSelfReferences(rows, [{ from: "parent_id", to: "id" }]).map(
      (statement) => parseInsert(statement).row.id,
    ),
    ["1", "2", "3", "4"],
  );
  assert.deepEqual(parseInsert(rows[0]).row, { id: "3", parent_id: "2", note: "c, (x)" });
});

test("cycles through nullable references insert NULL first and restore it afterwards", () => {
  const info = {
    campaigns: {
      keys: [{ table: "assets", from: "cover_asset_id", to: "id" }],
      columns: [
        { name: "id", notnull: 0, pk: 1 },
        { name: "cover_asset_id", notnull: 0, pk: 0 },
      ],
    },
    assets: {
      keys: [{ table: "campaigns", from: "campaign_id", to: "id" }],
      columns: [
        { name: "id", notnull: 0, pk: 1 },
        { name: "campaign_id", notnull: 1, pk: 0 },
      ],
    },
  };
  const plan = planInsertOrder(["assets", "campaigns"], info);
  assert.deepEqual(plan.order, ["campaigns", "assets"]);
  assert.deepEqual(plan.deferred, { campaigns: ["cover_asset_id"] });
  const sql = orderInserts(
    [
      `INSERT INTO "assets" ("id","campaign_id") VALUES(9,1);`,
      `INSERT INTO "campaigns" ("id","cover_asset_id") VALUES(1,9);`,
    ].join("\n"),
    plan,
  );
  assert.deepEqual(splitStatements(sql), [
    `INSERT INTO "campaigns" ("id","cover_asset_id") VALUES(1,NULL);`,
    `INSERT INTO "assets" ("id","campaign_id") VALUES(9,1);`,
    `UPDATE "campaigns" SET "cover_asset_id" = 9 WHERE "id" = 1;`,
  ]);
  info.campaigns.columns[1].notnull = 1;
  assert.throws(() => planInsertOrder(["assets", "campaigns"], info), /cycle through NOT NULL/);
});

test("trigger bodies stay one statement", () => {
  assert.deepEqual(
    splitStatements(
      "CREATE TRIGGER t AFTER DELETE ON a BEGIN DELETE FROM b; UPDATE c SET x = 'END;'; END;\nSELECT 1;",
    ),
    [
      "CREATE TRIGGER t AFTER DELETE ON a BEGIN DELETE FROM b; UPDATE c SET x = 'END;'; END;",
      "SELECT 1;",
    ],
  );
});

test("comments in schema SQL do not open strings or end statements", () => {
  assert.deepEqual(
    splitStatements(
      'CREATE TABLE t (\n  -- JSON [{ "s": 1 }]; note\n  a TEXT /* it\'s; */\n);\nSELECT 1;',
    ),
    ['CREATE TABLE t (\n  -- JSON [{ "s": 1 }]; note\n  a TEXT /* it\'s; */\n);', "SELECT 1;"],
  );
});

test("copied relying-party identities follow the slot's issuer", () => {
  const columns = issuerColumns({
    user: ["id", "email", "oidc_issuer", "oidc_subject"],
    oidc_session: ["id", "issuer"],
    links: ["id"],
  });
  assert.deepEqual(columns, [
    { table: "user", column: "oidc_issuer" },
    { table: "oidc_session", column: "issuer" },
  ]);
  assert.deepEqual(issuerRewriteSql(columns.slice(0, 1), "stg-2"), [
    `UPDATE "user" SET "oidc_issuer" = 'https://accounts.stg2.gdgs.jp' WHERE "oidc_issuer" = 'https://accounts.gdgs.jp';`,
  ]);
});

test("each slot sits behind one Access application for gdg-jp members and CI", () => {
  const body = applicationBody({ slot: "stg-2", identityProviderId: "idp", serviceTokenId: "tok" });
  assert.equal(body.name, "GDG staging stg2");
  assert.deepEqual(
    body.destinations.map(({ uri }) => uri),
    ["*.stg2.gdgs.jp", "stg2.gdgs.jp"],
  );
  assert.deepEqual(body.allowed_idps, ["idp"]);
  assert.deepEqual(
    body.policies.map(({ decision, include }) => [decision, Object.keys(include[0])[0]]),
    [
      ["non_identity", "service_token"],
      ["allow", "github_organization"],
    ],
  );
  assert.equal(body.policies[1].include[0].github_organization.name, "gdg-jp");
});
