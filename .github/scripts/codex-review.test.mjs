import assert from "node:assert/strict";
import test from "node:test";

import {
  authSecrets,
  decrypt,
  encrypt,
  newestFirst,
  parseDeviceLogin,
  redact,
} from "./codex-auth.mjs";
import {
  LABEL,
  anchor,
  evaluate,
  findingBody,
  hasWork,
  marker,
  markers,
  mentionReply,
  parsePullRequest,
  plan,
  reviewBody,
  rightSideLines,
  sanitize,
  verdictBody,
} from "./codex-review.mjs";

const bot = { __typename: "Bot", login: "github-actions" };
const otherBot = { __typename: "Bot", login: "dependabot" };
const alice = { __typename: "User", login: "alice" };
const mallory = { __typename: "User", login: "mallory" };
const trusted = new Set(["alice"]);

function rawPullRequest({
  labels = [],
  labeledAt = [],
  reviews = [],
  threads = [],
  comments = [],
  isCrossRepository = false,
  status = null,
} = {}) {
  return {
    number: 7,
    url: "https://github.com/gdg-jp/gdgjp/pull/7",
    title: "Add a feature",
    body: "",
    state: "OPEN",
    isDraft: false,
    isCrossRepository,
    headRefOid: "head-sha",
    baseRefName: "main",
    author: { login: "alice" },
    labels: { nodes: labels.map((name) => ({ name })) },
    timelineItems: {
      nodes: labeledAt.map((createdAt) => ({ createdAt, label: { name: LABEL } })),
    },
    commits: { nodes: [{ commit: { oid: "head-sha", status: status && { context: status } } }] },
    reviews: { nodes: reviews },
    reviewThreads: { nodes: threads },
    comments: { nodes: comments },
  };
}

function review(at, requested = at) {
  return {
    author: bot,
    createdAt: at,
    url: "https://example.test/review",
    body: `## Codex review\n\n${marker("review", { head: "old-sha", requested })}`,
  };
}

function thread(id, { at = "2026-11-01T00:10:00Z", reactions = [], replies = [] } = {}) {
  return {
    id: `thread-${id}`,
    isResolved: false,
    path: "src/a.ts",
    line: 3,
    comments: {
      nodes: [
        {
          databaseId: 100,
          author: bot,
          createdAt: at,
          url: `https://example.test/${id}`,
          body: `**[P1] 問題 ${id}**\n\n本文\n\n${marker("finding", { id, head: "old-sha" })}`,
          reactions: { nodes: reactions },
        },
        ...replies,
      ],
    },
  };
}

function verdict(id, status, at, seen) {
  return {
    databaseId: 200,
    author: bot,
    createdAt: at,
    body: `判定\n\n${marker("verdict", { id, status, seen })}`,
    reactions: { nodes: [] },
  };
}

function run(options) {
  return evaluate(parsePullRequest(rawPullRequest(options)), trusted);
}

test("markers round-trip their fields", () => {
  const body = `text ${marker("verdict", { id: "12.3", status: "resolved", seen: "2026-11-01T00:00:00.000Z" })}`;
  assert.deepEqual(markers(body), [
    { kind: "verdict", id: "12.3", status: "resolved", seen: "2026-11-01T00:00:00.000Z" },
  ]);
  assert.equal(
    marker("finding", { id: "1.1", path: undefined }),
    "<!-- codex-review:finding id=1.1 -->",
  );
});

test("a PR without a Codex review waits for the label", () => {
  const result = run();
  assert.equal(result.gate.state, "pending");
  assert.match(result.gate.description, /E-code-review/);
  assert.equal(hasWork(result), false);
});

test("adding the label requests a review until one is posted after it", () => {
  const requested = run({ labels: [LABEL], labeledAt: ["2026-11-01T00:00:00Z"] });
  assert.equal(requested.reviewRequested, true);
  assert.equal(requested.gate.state, "pending");

  const done = run({
    labels: [LABEL],
    labeledAt: ["2026-11-01T00:00:00Z"],
    reviews: [review("2026-11-01T00:05:00Z", "2026-11-01T00:00:00Z")],
  });
  assert.equal(done.reviewRequested, false);
  assert.equal(done.gate.state, "success");

  const again = run({
    labels: [LABEL],
    labeledAt: ["2026-11-01T00:00:00Z", "2026-11-02T00:00:00Z"],
    reviews: [review("2026-11-01T00:05:00Z", "2026-11-01T00:00:00Z")],
  });
  assert.equal(again.reviewRequested, true);
});

test("unresolved findings fail the gate and a later review is optional", () => {
  const result = run({ reviews: [review("2026-11-01T00:05:00Z")], threads: [thread("1.1")] });
  assert.equal(result.gate.state, "failure");
  assert.equal(result.gate.description, "1 of 1 Codex findings are unresolved");
  assert.equal(hasWork(result), false);
});

test("a trusted reaction or reply asks the agent to verify the finding", () => {
  const reacted = run({
    reviews: [review("2026-11-01T00:05:00Z")],
    threads: [
      thread("1.1", {
        reactions: [
          { content: "THUMBS_UP", createdAt: "2026-11-01T01:00:00Z", user: { login: "alice" } },
        ],
      }),
    ],
  });
  assert.equal(reacted.verifications.length, 1);
  assert.equal(reacted.verifications[0].claims[0].kind, "reaction");
  assert.equal(reacted.gate.state, "pending");

  const replied = run({
    reviews: [review("2026-11-01T00:05:00Z")],
    threads: [
      thread("1.1", {
        replies: [
          {
            author: alice,
            createdAt: "2026-11-01T01:00:00Z",
            body: "解決しました",
            reactions: { nodes: [] },
          },
        ],
      }),
    ],
  });
  assert.deepEqual(
    replied.verifications[0].claims.map((claim) => claim.body),
    ["解決しました"],
  );
});

test("untrusted people and other bots cannot claim a finding", () => {
  const result = run({
    reviews: [review("2026-11-01T00:05:00Z")],
    threads: [
      thread("1.1", {
        reactions: [
          { content: "HEART", createdAt: "2026-11-01T01:00:00Z", user: { login: "mallory" } },
        ],
        replies: [
          {
            author: mallory,
            createdAt: "2026-11-01T01:00:00Z",
            body: "fixed",
            reactions: { nodes: [] },
          },
          {
            author: otherBot,
            createdAt: "2026-11-01T01:00:00Z",
            body: "fixed",
            reactions: { nodes: [] },
          },
        ],
      }),
    ],
  });
  assert.equal(result.verifications.length, 0);
  assert.equal(result.gate.state, "failure");
});

test("only the agent's verdict resolves a finding", () => {
  const resolved = run({
    reviews: [review("2026-11-01T00:05:00Z")],
    threads: [
      thread("1.1", {
        replies: [
          {
            author: alice,
            createdAt: "2026-11-01T01:00:00Z",
            body: "直しました",
            reactions: { nodes: [] },
          },
          verdict("1.1", "resolved", "2026-11-01T01:10:00Z", "2026-11-01T01:05:00Z"),
        ],
      }),
    ],
  });
  assert.equal(resolved.gate.state, "success");
  assert.equal(resolved.gate.description, "All 1 Codex findings are resolved");

  const forged = run({
    reviews: [review("2026-11-01T00:05:00Z")],
    threads: [
      thread("1.1", {
        replies: [
          {
            author: alice,
            createdAt: "2026-11-01T01:00:00Z",
            body: marker("verdict", { id: "1.1", status: "resolved" }),
            reactions: { nodes: [] },
          },
        ],
      }),
    ],
  });
  assert.equal(forged.findings[0].resolved, false);
});

test("an unresolved verdict waits for a response newer than what the agent saw", () => {
  const options = (replyAt) => ({
    reviews: [review("2026-11-01T00:05:00Z")],
    threads: [
      thread("1.1", {
        replies: [
          {
            author: alice,
            createdAt: "2026-11-01T01:00:00Z",
            body: "直しました",
            reactions: { nodes: [] },
          },
          { author: alice, createdAt: replyAt, body: "再度直しました", reactions: { nodes: [] } },
          verdict("1.1", "unresolved", "2026-11-01T01:10:00Z", "2026-11-01T01:05:00Z"),
        ],
      }),
    ],
  });
  const during = run(options("2026-11-01T01:07:00Z"));
  assert.deepEqual(
    during.verifications[0].claims.map((claim) => claim.body),
    ["再度直しました"],
  );
  const before = run(options("2026-11-01T01:02:00Z"));
  assert.equal(before.verifications.length, 0);
  assert.equal(before.gate.state, "failure");
});

test("a mention claims every unresolved finding once", () => {
  const mention = {
    databaseId: 555,
    author: alice,
    createdAt: "2026-11-01T02:00:00Z",
    body: "/codex 全部直しました",
    url: "https://example.test/mention",
    reactions: { nodes: [] },
  };
  const result = run({
    reviews: [review("2026-11-01T00:05:00Z")],
    threads: [thread("1.1"), thread("1.2")],
    comments: [mention],
  });
  assert.equal(result.pendingMentions.length, 1);
  assert.deepEqual(
    result.verifications.map((finding) => finding.id),
    ["1.1", "1.2"],
  );

  const acked = run({
    reviews: [review("2026-11-01T00:05:00Z")],
    threads: [thread("1.1")],
    comments: [
      mention,
      {
        author: bot,
        createdAt: "2026-11-01T02:10:00Z",
        body: marker("ack", { comment: "555" }),
        reactions: { nodes: [] },
      },
    ],
  });
  assert.equal(acked.pendingMentions.length, 0);
});

test("mentions before the first review are ignored", () => {
  const result = run({
    reviews: [review("2026-11-01T00:05:00Z")],
    threads: [thread("1.1")],
    comments: [
      {
        databaseId: 1,
        author: alice,
        createdAt: "2026-10-01T00:00:00Z",
        body: "/codex",
        reactions: { nodes: [] },
      },
    ],
  });
  assert.equal(result.pendingMentions.length, 0);
});

test("findings posted as PR comments take reactions and PR-level verdicts", () => {
  const finding = {
    databaseId: 300,
    author: bot,
    createdAt: "2026-11-01T00:10:00Z",
    url: "https://example.test/issue-finding",
    body: findingBody(
      { priority: "P2", title: "外側の問題", body: "説明", path: "docs/x.md", line: 9 },
      { id: "9.1", head: "old-sha", index: 1, issue: true },
    ),
    reactions: {
      nodes: [{ content: "ROCKET", createdAt: "2026-11-01T01:00:00Z", user: { login: "alice" } }],
    },
  };
  const pending = run({ reviews: [review("2026-11-01T00:05:00Z")], comments: [finding] });
  assert.equal(pending.verifications[0].kind, "issue");
  assert.equal(pending.verifications[0].path, "docs/x.md");

  const done = run({
    reviews: [review("2026-11-01T00:05:00Z")],
    comments: [
      finding,
      {
        author: bot,
        createdAt: "2026-11-01T01:20:00Z",
        body: verdictBody(
          { resolved: true, reply: "ok" },
          { id: "9.1", seen: "2026-11-01T01:10:00Z" },
        ),
        reactions: { nodes: [] },
      },
    ],
  });
  assert.equal(done.gate.state, "success");
});

test("fork PRs fail the gate without starting the agent", () => {
  const result = run({ isCrossRepository: true, labels: [LABEL] });
  assert.equal(result.gate.state, "failure");
  assert.equal(hasWork(result), false);
});

test("right-side diff lines include added and context lines only", () => {
  const patch =
    "@@ -1,3 +1,4 @@\n a\n-b\n+c\n+d\n e\n@@ -10,2 +11,2 @@\n x\n-y\n+z\n\\ No newline at end of file";
  assert.deepEqual([...rightSideLines(patch)], [1, 2, 3, 4, 11, 12]);
  const files = new Map([["src/a.ts", { lines: rightSideLines(patch) }]]);
  assert.deepEqual(anchor({ path: "src/a.ts", line: 3 }, files), {
    kind: "line",
    path: "src/a.ts",
    line: 3,
  });
  assert.deepEqual(anchor({ path: "src/a.ts", line: 30 }, files), {
    kind: "file",
    path: "src/a.ts",
  });
  assert.deepEqual(anchor({ path: "other.ts", line: 1 }, files), { kind: "issue" });
});

test("review and mention bodies carry the markers the gate reads", () => {
  const body = reviewBody(
    { summary: "概ね良いです。", findings: [] },
    {
      head: "abcdef1234",
      requested: "2026-11-01T00:00:00.000Z",
      findingCount: 0,
      model: "m (medium)",
    },
  );
  assert.deepEqual(markers(body), [
    { kind: "review", head: "abcdef1234", requested: "2026-11-01T00:00:00.000Z" },
  ]);
  const reply = mentionReply({ id: "555", by: "alice" }, []);
  assert.deepEqual(markers(reply), [{ kind: "ack", comment: "555" }]);
});

test("plan publishes the gate and returns PRs with pending work", async () => {
  const published = [];
  const prs = {
    1: parsePullRequest({ ...rawPullRequest({ labels: [LABEL] }), number: 1 }),
    2: parsePullRequest({ ...rawPullRequest(), number: 2 }),
    3: parsePullRequest({
      ...rawPullRequest({
        labels: [LABEL],
        status: { state: "ERROR", description: "Codex agent failed; retry" },
      }),
      number: 3,
    }),
  };
  const repo = {
    openPullRequests: async () => [1, 2, 3],
    evaluate: async (number) => ({ pr: prs[number], evaluation: evaluate(prs[number], trusted) }),
    publishGate: async (pr, gate) => published.push([pr.number, gate.state]),
  };
  assert.deepEqual(await plan({ repo, event: {}, authAvailable: async () => true }), [1]);
  assert.deepEqual(published, [
    [1, "pending"],
    [2, "pending"],
  ]);

  published.length = 0;
  assert.deepEqual(
    await plan({ repo, event: { pull_request: { number: 1 } }, authAvailable: async () => false }),
    [],
  );
  assert.deepEqual(published, [[1, "error"]]);
});

test("Codex credentials are encrypted, masked, and redacted", () => {
  const key = "k".repeat(40);
  const auth = JSON.stringify({
    tokens: {
      access_token: "eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJ1c2VyLTEyMyJ9.c2lnbmF0dXJlLXZhbHVl",
      refresh_token: "rt_abcdefghijklmnopqrstuvwxyz",
      account_id: "short",
    },
  });
  const envelope = encrypt(auth, key);
  assert.doesNotMatch(envelope, /rt_abcdef/);
  assert.equal(decrypt(envelope, key), auth);
  assert.throws(() => decrypt(envelope, "x".repeat(40)));
  assert.throws(() => encrypt(auth, "short"));

  const secrets = authSecrets(JSON.parse(auth));
  assert.ok(secrets.includes("rt_abcdefghijklmnopqrstuvwxyz"));
  assert.ok(!secrets.includes("short"));
  const leaked = sanitize(
    { reply: "token rt_abcdefghijklmnopqrstuvwxyz and eyJzdWIiOiJ1c2VyLTEyMyJ9" },
    secrets,
  );
  assert.equal(leaked.reply, "token [redacted] and [redacted]");
  assert.equal(redact("eyJaaaaaaaaaaaa.bbbbbbbbbbbb.cccccccccccc", []), "[redacted]");
});

test("the device login link and code are read from Codex output", () => {
  const output =
    "1. Open this link\n   \u001b[94mhttps://auth.openai.com/codex/device\u001b[0m\n\n2. Enter this one-time code \u001b[90m(expires in 15 minutes)\u001b[0m\n   \u001b[94mYMLF-CU575\u001b[0m\n";
  assert.deepEqual(parseDeviceLogin(output), {
    url: "https://auth.openai.com/codex/device",
    code: "YMLF-CU575",
  });
  assert.equal(parseDeviceLogin("Welcome to Codex"), null);
});

test("the newest stored login is used first", () => {
  const sorted = newestFirst([
    { id: 1, created_at: "2026-11-01T00:00:00Z" },
    { id: 2, created_at: "2026-11-03T00:00:00Z" },
    { id: 3, created_at: "2026-11-02T00:00:00Z" },
  ]);
  assert.deepEqual(
    sorted.map((artifact) => artifact.id),
    [2, 3, 1],
  );
});
