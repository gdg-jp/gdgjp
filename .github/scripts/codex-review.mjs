import { spawn } from "node:child_process";
import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { appendFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { AppTokenSource, GitHubClient, readAuthSecrets, redact } from "./codex-auth.mjs";

export const LABEL = "E-code-review";
export const STATUS_CONTEXT = "ai-review";
export const BOT_LOGIN = "gdg-chan";
export const DOCS_URL = "https://github.com/gdg-jp/gdgjp/blob/main/docs/engineering/ai-review.md";
const AGENT_FAILED = "Codex agent failed";
export const GATED_BASES = ["main"];
const TRIGGER = /(^|\s)(@gdg-chan\b|\/ai-review\b)/i;
const MARKER = /<!-- codex-review:(\w+)((?: [\w-]+=[^\s>]+)*) -->/g;
const TRUSTED_ROLES = new Set(["admin", "maintain", "write"]);
const PRIORITIES = ["P0", "P1", "P2", "P3"];

export function markers(body) {
  const found = [];
  for (const match of (body ?? "").matchAll(MARKER)) {
    const fields = {};
    for (const pair of match[2].trim().split(" ").filter(Boolean)) {
      const index = pair.indexOf("=");
      fields[pair.slice(0, index)] = decodeURIComponent(pair.slice(index + 1));
    }
    found.push({ kind: match[1], ...fields });
  }
  return found;
}

let signingKey = null;

export function setSigningKey(key) {
  if (!key || key.length < 32) {
    throw new Error("AI_REVIEW_SIGNING_KEY must be a random value of at least 32 characters");
  }
  signingKey = key;
}

function signature(kind, fields) {
  if (!signingKey) throw new Error("The marker signing key is not configured");
  const payload = [
    kind,
    ...Object.keys(fields)
      .filter((key) => key !== "sig")
      .sort()
      .map((key) => `${key}=${fields[key]}`),
  ].join("\n");
  return createHmac("sha256", signingKey).update(payload).digest("hex").slice(0, 32);
}

export function marker(kind, fields) {
  const present = Object.fromEntries(
    Object.entries(fields)
      .filter(([, value]) => value !== undefined && value !== null)
      .map(([key, value]) => [key, String(value)])
      .filter(([, value]) => value !== ""),
  );
  const signed = { ...present, sig: signature(kind, present) };
  const pairs = Object.entries(signed)
    .map(([key, value]) => ` ${key}=${encodeURIComponent(value)}`)
    .join("");
  return `<!-- codex-review:${kind}${pairs} -->`;
}

export function authentic(item, number) {
  if (!item?.sig || item.pr !== String(number)) return false;
  const { kind, ...fields } = item;
  const expected = Buffer.from(signature(kind, fields));
  const actual = Buffer.from(item.sig);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function isBot(author) {
  return author?.__typename === "Bot" && author.login === BOT_LOGIN;
}

function isHuman(author) {
  return Boolean(author?.login) && author.__typename !== "Bot";
}

function reactionClaims(reactions) {
  return (reactions?.nodes ?? [])
    .filter((reaction) => reaction.user?.login)
    .map((reaction) => ({
      kind: "reaction",
      by: reaction.user.login,
      at: reaction.createdAt,
      body: reaction.content,
      key: `r:${reaction.user.login}:${reaction.content}:${reaction.createdAt}`,
    }));
}

export function contentDigest(body) {
  const text = (body ?? "").slice(0, Math.max(0, (body ?? "").lastIndexOf("<!-- codex-review:")));
  return createHash("sha256").update(text.trimEnd()).digest("hex").slice(0, 32);
}

export function parsePullRequest(raw) {
  let tampered = 0;
  const editedByOthers = (post) => Boolean(post.editor?.login) && post.editor.login !== BOT_LOGIN;
  const trailing = (body, kinds) => {
    if (!(body ?? "").trim()) return null;
    const item = markers(body).at(-1);
    const valid =
      item &&
      kinds.includes(item.kind) &&
      authentic(item, raw.number) &&
      (item.kind !== "finding" || item.digest === contentDigest(body));
    if (!valid) tampered += 1;
    return valid ? item : null;
  };
  const reviews = [];
  for (const review of raw.reviews?.nodes ?? []) {
    if (!isBot(review.author)) continue;
    if (editedByOthers(review)) tampered += 1;
    const found = trailing(review.body, ["review"]);
    if (found) {
      reviews.push({
        at: review.createdAt,
        requested: found.requested ?? review.createdAt,
        requests: found.requests === undefined ? null : found.requests.split(","),
        head: found.head,
        findings: (found.findings ?? "").split(",").filter(Boolean),
        url: review.url,
      });
    }
  }

  const findings = new Map();
  const verdicts = [];
  const acked = new Set();
  const mentions = [];

  for (const thread of raw.reviewThreads?.nodes ?? []) {
    const [first, ...replies] = thread.comments?.nodes ?? [];
    if (!first || !isBot(first.author)) continue;
    if (editedByOthers(first)) tampered += 1;
    const found = trailing(first.body, ["finding"]);
    if (!found) continue;
    const claims = reactionClaims(first.reactions);
    for (const reply of replies) {
      if (isBot(reply.author)) {
        if (editedByOthers(reply)) tampered += 1;
        const item = trailing(reply.body, ["verdict"]);
        if (item && item.id === found.id) verdicts.push({ ...item, at: reply.createdAt });
        else if (item) tampered += 1;
      } else if (isHuman(reply.author)) {
        claims.push({
          kind: "reply",
          by: reply.author.login,
          at: reply.createdAt,
          body: reply.body,
          key: `c:${reply.databaseId}`,
        });
      }
    }
    findings.set(found.id, {
      id: found.id,
      head: found.head,
      kind: "thread",
      commentId: first.databaseId,
      threadId: thread.id,
      threadResolved: thread.isResolved,
      path: thread.path,
      line: thread.line ?? thread.originalLine ?? null,
      body: first.body,
      url: first.url,
      at: first.createdAt,
      claims,
    });
  }

  for (const comment of raw.comments?.nodes ?? []) {
    if (isBot(comment.author)) {
      if (editedByOthers(comment)) tampered += 1;
      const item = trailing(comment.body, ["finding", "verdict", "ack"]);
      if (item?.kind === "finding") {
        findings.set(item.id, {
          id: item.id,
          head: item.head,
          kind: "issue",
          commentId: comment.databaseId,
          path: item.path ?? null,
          line: null,
          body: comment.body,
          url: comment.url,
          at: comment.createdAt,
          claims: reactionClaims(comment.reactions),
        });
      } else if (item?.kind === "verdict") {
        verdicts.push({ ...item, at: comment.createdAt });
      } else if (item?.kind === "ack") {
        acked.add(item.comment);
      }
    } else if (isHuman(comment.author) && TRIGGER.test(comment.body ?? "")) {
      mentions.push({
        id: String(comment.databaseId),
        by: comment.author.login,
        at: comment.createdAt,
        body: comment.body,
        url: comment.url,
      });
    }
  }

  for (const verdict of verdicts) {
    const finding = findings.get(verdict.id);
    if (!finding) continue;
    finding.verdicts ??= [];
    finding.verdicts.push({
      status: verdict.status,
      at: verdict.at,
      seen: verdict.seen ?? verdict.at,
      handled: verdict.handled === undefined ? null : new Set(verdict.handled.split(",")),
    });
  }

  const labelEvents = (raw.timelineItems?.nodes ?? [])
    .filter((event) => event.label?.name === LABEL)
    .map((event) => ({ id: event.id ?? `t:${event.createdAt}`, at: event.createdAt }));
  const labeledAt = labelEvents.map((event) => event.at);

  const commit = raw.commits?.nodes?.[0]?.commit;
  return {
    number: raw.number,
    url: raw.url,
    title: raw.title,
    body: raw.body ?? "",
    state: raw.state,
    isDraft: raw.isDraft,
    isCrossRepository: raw.isCrossRepository,
    author: raw.author?.login ?? null,
    baseRef: raw.baseRefName,
    headSha: raw.headRefOid,
    labels: (raw.labels?.nodes ?? []).map((label) => label.name),
    labeledAt,
    labelEvents,
    status: commit?.oid === raw.headRefOid ? (commit?.status?.context ?? null) : null,
    reviews,
    tampered,
    findings: [...findings.values()].map((finding) => ({
      ...finding,
      verdicts: (finding.verdicts ?? []).sort((a, b) => time(a.at) - time(b.at)),
    })),
    acked,
    mentions,
  };
}

function time(value) {
  return Date.parse(value);
}

export function humanActors(pr) {
  const actors = new Set();
  for (const finding of pr.findings) {
    for (const claim of finding.claims) actors.add(claim.by);
  }
  for (const mention of pr.mentions) actors.add(mention.by);
  return actors;
}

const SEVERITY = { failure: 3, error: 3, pending: 2, success: 1 };

export function combineGates(self, siblings) {
  const members = [self, ...siblings].sort((a, b) => a.number - b.number);
  const reviewed = members.filter((member) => member.reviewed);
  if (reviewed.length === 0) return self.gate;
  const worst = reviewed.reduce((current, member) =>
    SEVERITY[member.gate.state] > SEVERITY[current.gate.state] ? member : current,
  );
  if (siblings.length === 0) return worst.gate;
  return {
    state: worst.gate.state,
    description: `#${worst.number} (same change as #${members
      .filter((member) => member !== worst)
      .map((member) => member.number)
      .join(", #")}): ${worst.gate.description}`,
  };
}

export function handledKeys(finding) {
  return new Set(finding.verdicts.flatMap((verdict) => [...(verdict.handled ?? [])]));
}

export function evaluate(pr, trusted) {
  const firstReviewAt = pr.reviews.length
    ? Math.min(...pr.reviews.map((review) => time(review.at)))
    : null;
  const pendingMentions = pr.mentions.filter(
    (mention) =>
      trusted.has(mention.by) &&
      !pr.acked.has(mention.id) &&
      firstReviewAt !== null &&
      time(mention.at) > firstReviewAt,
  );

  const findings = pr.findings.map((finding) => {
    const last = finding.verdicts.at(-1);
    const resolved = last?.status === "resolved";
    const handled = handledKeys(finding);
    const legacySeen = Math.max(
      ...finding.verdicts
        .filter((verdict) => verdict.handled === null)
        .map((verdict) => time(verdict.seen)),
      time(finding.at),
    );
    const unseen = (claim) => !handled.has(claim.key) && time(claim.at) > legacySeen;
    const claims = resolved
      ? []
      : [
          ...finding.claims.filter((claim) => trusted.has(claim.by) && unseen(claim)),
          ...pendingMentions
            .map((mention) => ({
              kind: "mention",
              by: mention.by,
              at: mention.at,
              body: mention.body,
              key: `c:${mention.id}`,
            }))
            .filter(unseen),
        ];
    return { ...finding, resolved, claims };
  });

  const handledRequests = new Set(pr.reviews.flatMap((review) => review.requests ?? []));
  const legacyRequested = Math.max(
    ...pr.reviews
      .filter((review) => review.requests === null)
      .map((review) => time(review.requested)),
    Number.NEGATIVE_INFINITY,
  );
  const reviewRequested = pr.labelEvents.some(
    (event) => !handledRequests.has(event.id) && time(event.at) > legacyRequested,
  );

  const verifications = findings.filter((finding) => finding.claims.length > 0);
  const unresolved = findings.filter((finding) => !finding.resolved);
  const present = new Set(findings.map((finding) => finding.id));
  const missing = pr.reviews.flatMap((review) => review.findings).filter((id) => !present.has(id));
  const threadsToSync = findings.filter(
    (finding) => finding.kind === "thread" && finding.resolved && !finding.threadResolved,
  );

  let gate;
  if (missing.length > 0 || pr.tampered > 0) {
    gate = {
      state: "failure",
      description: `${missing.length + pr.tampered} GDG-chan finding comments were deleted or altered; a maintainer must review and bypass`,
    };
  } else if (pr.isCrossRepository) {
    gate = {
      state: "failure",
      description: "GDG-chan does not review fork PRs; a ruleset bypass is required",
    };
  } else if (reviewRequested) {
    gate = { state: "pending", description: "GDG-chan review is queued or running" };
  } else if (pr.reviews.length === 0) {
    gate = {
      state: "pending",
      description: `Add the ${LABEL} label to request the required GDG-chan review`,
    };
  } else if (unresolved.length === 0) {
    gate = {
      state: "success",
      description:
        findings.length === 0
          ? "GDG-chan review found no issues"
          : `All ${findings.length} GDG-chan findings are resolved`,
    };
  } else if (verifications.length > 0) {
    gate = {
      state: "pending",
      description: `GDG-chan is checking ${verifications.length} responded findings`,
    };
  } else {
    gate = {
      state: "failure",
      description: `${unresolved.length} of ${findings.length} GDG-chan findings are unresolved`,
    };
  }

  return {
    gate,
    reviewRequested: reviewRequested && !pr.isCrossRepository,
    findings,
    verifications: pr.isCrossRepository ? [] : verifications,
    pendingMentions: pr.isCrossRepository ? [] : pendingMentions,
    unresolved,
    missing,
    threadsToSync,
  };
}

export function hasWork(evaluation) {
  return (
    evaluation.reviewRequested ||
    evaluation.verifications.length > 0 ||
    evaluation.pendingMentions.length > 0
  );
}

export function rightSideLines(patch) {
  const lines = new Set();
  let line = 0;
  for (const row of (patch ?? "").split("\n")) {
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(row);
    if (hunk) {
      line = Number(hunk[1]);
      continue;
    }
    if (line === 0 || row.startsWith("-") || row.startsWith("\\")) continue;
    lines.add(line);
    line += 1;
  }
  return lines;
}

export function anchor(finding, files) {
  const file = files.get(finding.path);
  if (!file) return { kind: "issue" };
  if (file.lines.has(finding.line)) return { kind: "line", path: finding.path, line: finding.line };
  return { kind: "file", path: finding.path };
}

export function findingBody(finding, { pr, id, head, index, issue }) {
  const location =
    issue && finding.path ? `\`${finding.path}${finding.line ? `:${finding.line}` : ""}\`\n\n` : "";
  const howTo = issue
    ? "対応したらこのコメントにリアクションするか、`/ai-review` を含むコメントで確認を依頼してください。"
    : "対応したらこのコメントにリアクションするか返信してください。";
  const text = [
    `**[${finding.priority}] ${finding.title}**`,
    "",
    `${location}${finding.body.trim()}`,
    "",
    `<sub>GDG-chan finding ${index} · ${howTo}GDG-chan が修正を確認すると解決になります。</sub>`,
    "",
    "",
  ].join("\n");
  const digest = contentDigest(`${text}<!-- codex-review:`);
  return `${text}${marker("finding", { pr, id, head, path: issue ? finding.path : undefined, digest })}`;
}

export function reviewBody(result, { pr, head, requested, requests = [], ids, model }) {
  const findingCount = ids.length;
  const lines = [
    "## GDG-chan review",
    "",
    result.summary.trim(),
    "",
    findingCount === 0
      ? "指摘事項はありません。"
      : `指摘事項は ${findingCount} 件です。各指摘にリアクションするか返信すると、GDG-chan が修正を確認して解決にします。PR に \`/ai-review\` とコメントすると未解決の指摘をまとめて確認します。`,
    "",
    `<sub>${model} · ${head.slice(0, 7)} · [AI review gate](${DOCS_URL})</sub>`,
    "",
    marker("review", {
      pr,
      head,
      requested,
      requests: requests.join(","),
      findings: ids.join(","),
    }),
  ];
  return lines.join("\n");
}

export function verdictBody(verdict, { pr, id, seen, handled, head }) {
  const heading = verdict.resolved
    ? "✅ 解決を確認しました。"
    : "❌ まだ解決していません。修正したら、もう一度返信するかリアクションしてください。";
  return [
    heading,
    "",
    verdict.reply.trim(),
    "",
    marker("verdict", {
      pr,
      id,
      status: verdict.resolved ? "resolved" : "unresolved",
      seen,
      handled,
      head,
    }),
  ].join("\n");
}

function findingTitle(finding) {
  const match = /^\*\*(.+?)\*\*/m.exec(finding.body ?? "");
  return match ? match[1] : finding.id;
}

function stripMarkers(body) {
  return (body ?? "").replace(MARKER, "").trim();
}

export const REVIEW_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "findings"],
  properties: {
    summary: { type: "string" },
    findings: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["priority", "title", "body", "path", "line"],
        properties: {
          priority: { type: "string", enum: PRIORITIES },
          title: { type: "string" },
          body: { type: "string" },
          path: { type: "string" },
          line: { type: "integer" },
        },
      },
    },
  },
};

export const VERIFY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["verdicts"],
  properties: {
    verdicts: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "resolved", "reply"],
        properties: {
          id: { type: "string" },
          resolved: { type: "boolean" },
          reply: { type: "string" },
        },
      },
    },
  },
};

export function reviewPrompt(pr, { mergeBase, files, previous }) {
  return `You are the required code reviewer for pull request #${pr.number} in the gdg-jp/gdgjp repository.

Title: ${pr.title}

Description:
${pr.body.trim() || "(none)"}

The working directory is a checkout of the PR head commit ${pr.headSha}. The PR targets
\`${pr.baseRef}\`; the merge base is ${mergeBase}. Inspect the change with
\`git diff ${mergeBase} HEAD\` and read the surrounding code, tests, and the AGENTS.md files
that govern the changed directories. Do not modify any file.

Changed files:
${files.map((file) => `- ${file}`).join("\n")}

Report only actionable problems that this PR introduces or makes worse: incorrect behavior,
security or privacy issues, data loss, broken API or migration contracts, missing handling of
realistic failure cases, missing or wrong tests for changed behavior, and violations of the
repository rules in AGENTS.md. Do not report style preferences, speculative concerns you could
not confirm in the code, or praise. Each finding must be independently fixable.

For each finding give:
- priority: P0 (must not ship, breaks production or security), P1 (serious bug), P2 (real but
  contained defect), P3 (minor but worth fixing)
- title: one short Japanese sentence naming the problem
- body: Japanese Markdown explaining what is wrong, the concrete scenario where it fails, and how
  to fix it
- path: repository-relative path of the file to change
- line: the line number in the PR head version of that file where the problem is; prefer a line
  that the PR adds or modifies

${
  previous.length
    ? `These findings were already reported on this PR. Do not report them again:\n${previous
        .map((finding) => `- ${finding.path ?? "?"}:${finding.line ?? "?"} ${finding.title}`)
        .join("\n")}\n\n`
    : ""
}Write summary as one to three Japanese sentences giving your overall assessment of the PR.
Return an empty findings array when you find nothing that meets this bar.`;
}

export function verifyPrompt(pr, findings) {
  const items = findings.map((finding) => ({
    id: finding.id,
    reported_on_commit: finding.head ?? null,
    path: finding.path,
    line: finding.line,
    finding: stripMarkers(finding.body),
    previous_verdicts: finding.verdicts.map((verdict) => verdict.status),
    responses: finding.claims.map((claim) =>
      claim.kind === "reaction"
        ? { from: claim.by, reaction: claim.body }
        : { from: claim.by, message: claim.body },
    ),
  }));
  return `You verify responses to code review findings on pull request #${pr.number} in the
gdg-jp/gdgjp repository. The working directory is a checkout of the current PR head commit
${pr.headSha}. Do not modify any file.

Each finding below was reported by an earlier review. A person has since responded to it with a
reaction or a message. For every finding, inspect the current code yourself (read the files and
use git log or git diff against the commit the finding was reported on) and decide whether the
finding is cleared.

Set resolved to true only when one of these holds:
- the problem described by the finding no longer exists in the current code, or
- the person's message shows the finding was mistaken or does not apply, and you confirmed that
  against the code.
A reaction or a message such as "fixed" is not evidence by itself. If the fix is partial or
introduces a new problem in the same place, the finding is not resolved.

Write reply in Japanese Markdown. When resolved, name what you confirmed (file and line). When
not resolved, state precisely what remains and what change would clear it. Answer any question
the person asked. Return exactly one verdict for every id below.

Findings:
${JSON.stringify(items, null, 2)}`;
}

export function mentionReply(pr, mention, outcomes) {
  const lines = outcomes.length
    ? outcomes.map(
        (outcome) =>
          `- ${outcome.resolved ? "✅ 解決" : "❌ 未解決"}: [${outcome.title}](${outcome.url})`,
      )
    : ["未解決の指摘はありません。"];
  return [
    `@${mention.by} 確認しました。`,
    "",
    ...lines,
    "",
    marker("ack", { pr, comment: mention.id }),
  ].join("\n");
}

const PULL_REQUEST_QUERY = `query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      number url title body state isDraft isCrossRepository headRefOid baseRefName
      author { login }
      labels(first: 100) { nodes { name } }
      commits(last: 1) {
        nodes { commit { oid status { context(name: "${STATUS_CONTEXT}") { state description } } } }
      }
    }
  }
}`;

const COMMENT_FIELDS = `databaseId body createdAt url author { __typename login } editor { login }
  reactions(last: 50) { nodes { content createdAt user { login } } }`;

const CONNECTIONS = {
  reviews: {
    field: "reviews",
    nodes: "body createdAt url author { __typename login } editor { login }",
  },
  reviewThreads: {
    field: "reviewThreads",
    nodes: `id isResolved path line originalLine
      comments(first: 60) {
        pageInfo { hasNextPage endCursor }
        nodes { ${COMMENT_FIELDS} }
      }`,
  },
  comments: { field: "comments", nodes: COMMENT_FIELDS },
  timelineItems: {
    field: "timelineItems",
    args: "itemTypes: [LABELED_EVENT], ",
    nodes: "... on LabeledEvent { id createdAt label { name } }",
  },
};

function connectionQuery(name) {
  const { field, args = "", nodes } = CONNECTIONS[name];
  return `query($owner: String!, $name: String!, $number: Int!, $cursor: String) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      ${field}(${args}first: 50, after: $cursor) {
        pageInfo { hasNextPage endCursor }
        nodes { ${nodes} }
      }
    }
  }
}`;
}

const THREAD_COMMENTS_QUERY = `query($id: ID!, $cursor: String) {
  node(id: $id) {
    ... on PullRequestReviewThread {
      comments(first: 100, after: $cursor) {
        pageInfo { hasNextPage endCursor }
        nodes { ${COMMENT_FIELDS} }
      }
    }
  }
}`;

const OPEN_PULL_REQUESTS_QUERY = `query($owner: String!, $name: String!, $cursor: String) {
  repository(owner: $owner, name: $name) {
    pullRequests(states: OPEN, first: 100, after: $cursor) {
      pageInfo { hasNextPage endCursor }
      nodes { number headRefOid baseRefName isCrossRepository }
    }
  }
}`;

export class ReviewRepository {
  constructor({ github, repository }) {
    this.github = github;
    [this.owner, this.name] = repository.split("/");
    this.repository = repository;
    this.permissions = new Map();
  }

  async connection(number, name) {
    const nodes = [];
    let cursor = null;
    for (;;) {
      const data = await this.github.graphql(connectionQuery(name), {
        owner: this.owner,
        name: this.name,
        number,
        cursor,
      });
      const page = data.repository.pullRequest[CONNECTIONS[name].field];
      nodes.push(...page.nodes);
      if (!page.pageInfo.hasNextPage) return { nodes };
      cursor = page.pageInfo.endCursor;
    }
  }

  async pullRequest(number) {
    const data = await this.github.graphql(PULL_REQUEST_QUERY, {
      owner: this.owner,
      name: this.name,
      number,
    });
    const threads = await this.connection(number, "reviewThreads");
    for (const thread of threads.nodes) {
      let page = thread.comments.pageInfo;
      while (page.hasNextPage) {
        const more = await this.github.graphql(THREAD_COMMENTS_QUERY, {
          id: thread.id,
          cursor: page.endCursor,
        });
        thread.comments.nodes.push(...more.node.comments.nodes);
        page = more.node.comments.pageInfo;
      }
    }
    return parsePullRequest({
      ...data.repository.pullRequest,
      timelineItems: await this.connection(number, "timelineItems"),
      reviews: await this.connection(number, "reviews"),
      reviewThreads: threads,
      comments: await this.connection(number, "comments"),
    });
  }

  async openHeads() {
    const heads = new Map();
    let cursor = null;
    for (;;) {
      const data = await this.github.graphql(OPEN_PULL_REQUESTS_QUERY, {
        owner: this.owner,
        name: this.name,
        cursor,
      });
      const page = data.repository.pullRequests;
      for (const node of page.nodes) {
        if (!node.isCrossRepository) {
          heads.set(node.number, { head: node.headRefOid, base: node.baseRefName });
        }
      }
      if (!page.pageInfo.hasNextPage) break;
      cursor = page.pageInfo.endCursor;
    }
    return heads;
  }

  async openPullRequests() {
    return [...(await this.openHeads()).keys()];
  }

  async trusted(pr) {
    const result = new Set();
    for (const login of humanActors(pr)) {
      if (!this.permissions.has(login)) {
        try {
          const permission = await this.github.request(
            `/repos/${this.repository}/collaborators/${encodeURIComponent(login)}/permission`,
          );
          this.permissions.set(
            login,
            TRUSTED_ROLES.has(permission.role_name) || TRUSTED_ROLES.has(permission.permission),
          );
        } catch {
          this.permissions.set(login, false);
        }
      }
      if (this.permissions.get(login)) result.add(login);
    }
    return result;
  }

  async evaluate(number) {
    const pr = await this.pullRequest(number);
    const evaluation = evaluate(pr, await this.trusted(pr));
    evaluation.gate = await this.combined(pr, evaluation.gate);
    return { pr, evaluation };
  }

  async siblingGates(pr) {
    const siblings = [];
    for (const number of await this.sharedWith(pr)) {
      const sibling = await this.pullRequest(number);
      siblings.push({
        number,
        reviewed: sibling.reviews.length > 0,
        gate: evaluate(sibling, await this.trusted(sibling)).gate,
      });
    }
    return siblings;
  }

  async combined(pr, gate) {
    return combineGates(
      { number: pr.number, reviewed: pr.reviews.length > 0, gate },
      await this.siblingGates(pr),
    );
  }

  async sharedWith(pr) {
    return [...(await this.openHeads()).entries()]
      .filter(
        ([other, { head, base }]) =>
          other !== pr.number && head === pr.headSha && base === pr.baseRef,
      )
      .map(([other]) => other);
  }

  async publishGate(pr, gate, targetUrl = DOCS_URL) {
    if (gate.state === "success") {
      const before = await this.combined(pr, gate);
      if (before.state !== "success") return this.postGate(pr, before, targetUrl);
      const posted = await this.postGate(pr, gate, targetUrl);
      const after = await this.combined(pr, gate);
      if (after.state !== "success") await this.postGate(pr, after, targetUrl);
      return posted;
    }
    return this.postGate(pr, gate, targetUrl);
  }

  async postGate(pr, gate, targetUrl) {
    if (
      pr.status?.state === gate.state.toUpperCase() &&
      pr.status?.description === gate.description
    ) {
      return false;
    }
    await this.github.request(`/repos/${this.repository}/statuses/${pr.headSha}`, {
      method: "POST",
      body: {
        state: gate.state,
        context: STATUS_CONTEXT,
        description: gate.description.slice(0, 140),
        target_url: targetUrl,
      },
    });
    pr.status = { state: gate.state.toUpperCase(), description: gate.description };
    return true;
  }

  async changedFiles(number) {
    const files = await this.github.list(`/repos/${this.repository}/pulls/${number}/files`);
    return new Map(
      files
        .filter((file) => file.status !== "removed")
        .map((file) => [file.filename, { lines: rightSideLines(file.patch) }]),
    );
  }

  async postReview(pr, result, { runId, model, requested, requests }) {
    const files = await this.changedFiles(pr.number);
    const nonce = randomUUID().slice(0, 8);
    const prepared = result.findings.map((finding, index) => ({
      finding: {
        ...finding,
        priority: PRIORITIES.includes(finding.priority) ? finding.priority : "P2",
      },
      id: `${runId}.${nonce}.${index + 1}`,
      index: index + 1,
      anchor: anchor(finding, files),
    }));
    const inline = prepared.filter((item) => item.anchor.kind === "line");
    const body = reviewBody(result, {
      pr: pr.number,
      head: pr.headSha,
      requested,
      requests,
      ids: prepared.map((item) => item.id),
      model,
    });
    const comments = inline.map((item) => ({
      path: item.anchor.path,
      line: item.anchor.line,
      side: "RIGHT",
      body: findingBody(item.finding, {
        pr: pr.number,
        id: item.id,
        head: pr.headSha,
        index: item.index,
      }),
    }));
    for (const item of prepared) {
      if (!inline.includes(item)) await this.postStandaloneFinding(pr, item);
    }
    try {
      await this.github.request(`/repos/${this.repository}/pulls/${pr.number}/reviews`, {
        method: "POST",
        body: { commit_id: pr.headSha, event: "COMMENT", body, comments },
      });
    } catch (error) {
      console.log(`Inline review failed, posting findings separately: ${error.message}`);
      for (const item of inline) await this.postStandaloneFinding(pr, item);
      await this.github.request(`/repos/${this.repository}/pulls/${pr.number}/reviews`, {
        method: "POST",
        body: { commit_id: pr.headSha, event: "COMMENT", body },
      });
    }
  }

  async postStandaloneFinding(pr, item) {
    if (item.anchor.kind !== "issue") {
      try {
        await this.github.request(`/repos/${this.repository}/pulls/${pr.number}/comments`, {
          method: "POST",
          body: {
            commit_id: pr.headSha,
            path: item.anchor.path,
            ...(item.anchor.kind === "line"
              ? { line: item.anchor.line, side: "RIGHT" }
              : { subject_type: "file" }),
            body: findingBody(item.finding, {
              pr: pr.number,
              id: item.id,
              head: pr.headSha,
              index: item.index,
            }),
          },
        });
        return;
      } catch (error) {
        console.log(`File comment for ${item.id} failed, using a PR comment: ${error.message}`);
      }
    }
    await this.github.request(`/repos/${this.repository}/issues/${pr.number}/comments`, {
      method: "POST",
      body: {
        body: findingBody(item.finding, {
          pr: pr.number,
          id: item.id,
          head: pr.headSha,
          index: item.index,
          issue: true,
        }),
      },
    });
  }

  async postVerdict(pr, finding, verdict, seen) {
    const keys = handledKeys(finding);
    for (const claim of finding.claims) keys.add(claim.key);
    const handled = [...keys].join(",");
    const body = verdictBody(verdict, {
      pr: pr.number,
      id: finding.id,
      seen,
      handled,
      head: pr.headSha,
    });
    if (finding.kind === "thread") {
      await this.github.request(
        `/repos/${this.repository}/pulls/${pr.number}/comments/${finding.commentId}/replies`,
        { method: "POST", body: { body } },
      );
      if (verdict.resolved !== finding.threadResolved) {
        await this.setThreadResolved(finding, verdict.resolved);
      }
      return;
    }
    await this.github.request(`/repos/${this.repository}/issues/${pr.number}/comments`, {
      method: "POST",
      body: { body: `> ${findingTitle(finding)} (${finding.url})\n\n${body}` },
    });
  }

  async setThreadResolved(finding, resolved) {
    const mutation = resolved ? "resolveReviewThread" : "unresolveReviewThread";
    try {
      await this.github.graphql(
        `mutation($id: ID!) { ${mutation}(input: { threadId: $id }) { thread { id } } }`,
        { id: finding.threadId },
      );
    } catch (error) {
      console.log(`Could not ${mutation} for ${finding.id}: ${error.message}`);
    }
  }

  async syncThreads(evaluation) {
    for (const finding of evaluation.threadsToSync) await this.setThreadResolved(finding, true);
  }

  async postMentionReply(pr, mention, outcomes) {
    await this.github.request(`/repos/${this.repository}/issues/${pr.number}/comments`, {
      method: "POST",
      body: { body: mentionReply(pr.number, mention, outcomes) },
    });
  }

  async removeLabel(number) {
    try {
      await this.github.request(
        `/repos/${this.repository}/issues/${number}/labels/${encodeURIComponent(LABEL)}`,
        { method: "DELETE" },
      );
    } catch (error) {
      console.log(`Could not remove ${LABEL} from #${number}: ${error.message}`);
    }
  }
}

function run(command, args, { cwd, env, input, timeoutMs = 0 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = timeoutMs ? setTimeout(() => child.kill("SIGTERM"), timeoutMs) : undefined;
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      if (code === 0) resolve({ stdout, stderr });
      else {
        const error = new Error(`${command} ${args[0]} exited with ${code ?? signal}`);
        error.stdout = stdout;
        error.stderr = stderr;
        reject(error);
      }
    });
    child.stdin.end(input ?? "");
  });
}

export function sandboxConfig(codexHome) {
  const filesystem = `{":root"="read", ${JSON.stringify(codexHome)}="none"}`;
  return [
    "-c",
    'cli_auth_credentials_store="file"',
    "-c",
    'default_permissions="review"',
    "-c",
    `permissions.review.filesystem=${filesystem}`,
  ];
}

export class CodexRunner {
  constructor({ codexHome, model, effort, secrets, timeoutMs = 40 * 60 * 1000 }) {
    this.codexHome = codexHome;
    this.model = model;
    this.effort = effort;
    this.secrets = secrets;
    this.timeoutMs = timeoutMs;
  }

  async exec({ cwd, prompt, schema }) {
    const scratch = await mkdtemp(join(tmpdir(), "codex-run-"));
    const schemaPath = join(scratch, "schema.json");
    const outputPath = join(scratch, "output.json");
    await writeFile(schemaPath, JSON.stringify(schema));
    const args = [
      "exec",
      "--model",
      this.model,
      "-c",
      `model_reasoning_effort="${this.effort}"`,
      ...sandboxConfig(this.codexHome),
      "--ephemeral",
      "--ignore-user-config",
      "--output-schema",
      schemaPath,
      "--output-last-message",
      outputPath,
      "--cd",
      cwd,
      "-",
    ];
    const env = {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      LANG: "C.UTF-8",
      CODEX_HOME: this.codexHome,
    };
    try {
      const { stdout, stderr } = await run("codex", args, {
        cwd,
        env,
        input: prompt,
        timeoutMs: this.timeoutMs,
      });
      console.log(redact(`${stderr}\n${stdout}`, this.secrets));
      return JSON.parse(await readFile(outputPath, "utf8"));
    } catch (error) {
      console.log(redact(`${error.stderr ?? ""}\n${error.stdout ?? ""}`, this.secrets));
      throw error;
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  }
}

export function sanitize(value, secrets) {
  if (typeof value === "string") return redact(value, secrets).replaceAll("<!--", "&lt;!--");
  if (Array.isArray(value)) return value.map((item) => sanitize(item, secrets));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, sanitize(item, secrets)]),
    );
  }
  return value;
}

class Worktrees {
  constructor({ root }) {
    this.root = root;
  }

  async prepare(pr) {
    const dir = join(this.root, `pr-${pr.number}`);
    await rm(dir, { recursive: true, force: true });
    await run("git", ["worktree", "prune"]);
    await run("git", [
      "fetch",
      "--no-tags",
      "origin",
      `+refs/pull/${pr.number}/head:refs/codex/pr-${pr.number}`,
      `+refs/heads/${pr.baseRef}:refs/codex/base-${pr.number}`,
    ]);
    await run("git", ["worktree", "add", "--detach", dir, pr.headSha]);
    const { stdout } = await run("git", ["merge-base", `refs/codex/base-${pr.number}`, pr.headSha]);
    return { dir, mergeBase: stdout.trim() };
  }

  async remove(dir) {
    await run("git", ["worktree", "remove", "--force", dir]).catch(() => undefined);
  }
}

const ATTEMPTS = 3;

export async function processPullRequest({ repo, codex, worktrees, number, runId, runUrl, model }) {
  for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
    const { pr, evaluation } = await repo.evaluate(number);
    if (!GATED_BASES.includes(pr.baseRef)) return;
    await repo.syncThreads(evaluation);
    if (pr.state !== "OPEN" || !hasWork(evaluation)) {
      await repo.publishGate(pr, evaluation.gate);
      return;
    }
    await repo.publishGate(pr, { state: "pending", description: "GDG-chan is working" }, runUrl);
    const tree = await worktrees.prepare(pr);
    try {
      await handleWork({ repo, codex, tree, pr, evaluation, runId, model });
    } finally {
      await worktrees.remove(tree.dir);
    }
  }
  const after = await repo.evaluate(number);
  await repo.publishGate(after.pr, after.evaluation.gate);
}

export function latestClaim(finding) {
  return new Date(Math.max(...finding.claims.map((claim) => time(claim.at)))).toISOString();
}

async function handleWork({ repo, codex, tree, pr, evaluation, runId, model }) {
  const outcomes = new Map();
  if (evaluation.verifications.length > 0) {
    const result = sanitize(
      await codex.exec({
        cwd: tree.dir,
        prompt: verifyPrompt(pr, evaluation.verifications),
        schema: VERIFY_SCHEMA,
      }),
      codex.secrets,
    );
    const current = await repo.pullRequest(pr.number);
    if (current.headSha !== pr.headSha) {
      console.log(`#${pr.number} moved past ${pr.headSha} during verification; checking again.`);
      return;
    }
    const verdicts = new Map(result.verdicts.map((verdict) => [verdict.id, verdict]));
    for (const finding of evaluation.verifications) {
      const verdict = verdicts.get(finding.id) ?? {
        resolved: false,
        reply: "この指摘について判定を返せませんでした。もう一度返信して確認を依頼してください。",
      };
      await repo.postVerdict(pr, finding, verdict, latestClaim(finding));
      outcomes.set(finding.id, verdict.resolved);
    }
  }
  for (const mention of evaluation.pendingMentions) {
    const handled = evaluation.findings
      .filter((finding) => outcomes.has(finding.id))
      .filter((finding) =>
        finding.claims.some((claim) => claim.kind === "mention" && claim.at === mention.at),
      )
      .map((finding) => ({
        title: findingTitle(finding),
        url: finding.url,
        resolved: outcomes.get(finding.id),
      }));
    await repo.postMentionReply(pr, mention, handled);
  }
  if (evaluation.reviewRequested) {
    const files = [...(await repo.changedFiles(pr.number)).keys()];
    const requested = new Date(
      Math.max(...pr.labeledAt.map((value) => Date.parse(value)), 0) || Date.now(),
    ).toISOString();
    const result = sanitize(
      await codex.exec({
        cwd: tree.dir,
        prompt: reviewPrompt(pr, {
          mergeBase: tree.mergeBase,
          files,
          previous: evaluation.unresolved.map((finding) => ({
            path: finding.path,
            line: finding.line,
            title: findingTitle(finding),
          })),
        }),
        schema: REVIEW_SCHEMA,
      }),
      codex.secrets,
    );
    const current = await repo.pullRequest(pr.number);
    if (current.headSha !== pr.headSha) {
      console.log(`#${pr.number} moved past ${pr.headSha} during the review; reviewing again.`);
      return;
    }
    const requests = pr.labelEvents.map((event) => event.id);
    await repo.postReview(pr, result, { runId, model, requested, requests });
    const after = await repo.pullRequest(pr.number);
    if (after.labelEvents.every((event) => requests.includes(event.id))) {
      await repo.removeLabel(pr.number);
    }
  }
}

function eventPullRequest(event) {
  const requested = Number(event?.inputs?.pr);
  return Number.isInteger(requested) && requested > 0 ? requested : null;
}

async function writeOutput(name, value) {
  if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);
  console.log(`${name}=${value}`);
}

export async function plan({ repo, event, authAvailable }) {
  const target = eventPullRequest(event);
  const numbers = target ? [target] : await repo.openPullRequests();
  const work = [];
  for (const number of numbers) {
    const { pr, evaluation } = await repo.evaluate(number);
    if (pr.state !== "OPEN" || !GATED_BASES.includes(pr.baseRef)) continue;
    await repo.syncThreads(evaluation);
    const failedBefore =
      pr.status?.state === "ERROR" && pr.status.description.startsWith(AGENT_FAILED);
    if (hasWork(evaluation) && (target !== null || !failedBefore)) {
      if (!(await authAvailable())) {
        await repo.publishGate(pr, {
          state: "error",
          description: "Codex is not signed in; run the AI login workflow",
        });
        continue;
      }
      work.push(number);
      await repo.publishGate(pr, evaluation.gate);
    } else if (!failedBefore || target !== null) {
      await repo.publishGate(pr, evaluation.gate);
    }
  }
  return work;
}

export async function checkSandbox(codexHome) {
  const env = { PATH: process.env.PATH, HOME: process.env.HOME, CODEX_HOME: codexHome };
  const allowed = (command) =>
    run("codex", ["sandbox", ...sandboxConfig(codexHome), "--", ...command], { env }).then(
      () => true,
      () => false,
    );
  if (!(await allowed(["cat", process.argv[1]]))) {
    throw new Error("The Codex sandbox cannot read the repository");
  }
  if (await allowed(["cat", join(codexHome, "auth.json")])) {
    throw new Error("The Codex sandbox can read the Codex login");
  }
  if (await allowed(["touch", join(process.cwd(), ".codex-sandbox-probe")])) {
    throw new Error("The Codex sandbox can write to the checkout");
  }
  if (await allowed(["cat", `/proc/${process.pid}/environ`])) {
    throw new Error("The Codex sandbox can read the agent's environment");
  }
  console.log(
    "The Codex sandbox reads the checkout but cannot read the login or the agent's environment, and cannot write.",
  );
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  const repository = process.env.GITHUB_REPOSITORY;
  const tokens = new AppTokenSource({
    appId: process.env.GDG_CHAN_APP_ID,
    privateKey: process.env.GDG_CHAN_PRIVATE_KEY,
    repository,
  });
  const github = new GitHubClient({ tokens });
  const actions = new GitHubClient({ token: process.env.GITHUB_TOKEN });
  const repo = new ReviewRepository({ github, repository });
  const runUrl = `${process.env.GITHUB_SERVER_URL}/${repository}/actions/runs/${process.env.GITHUB_RUN_ID}`;

  if (command === "plan" || command === "agent") setSigningKey(process.env.AI_REVIEW_SIGNING_KEY);

  if (command === "plan") {
    const event = process.env.GITHUB_EVENT_PATH
      ? JSON.parse(await readFile(process.env.GITHUB_EVENT_PATH, "utf8"))
      : {};
    let available;
    const work = await plan({
      repo,
      event,
      authAvailable: async () => {
        available ??= (await actions.latestArtifact("codex-auth")) !== null;
        return available;
      },
    });
    await writeOutput("numbers", work.join(","));
    return;
  }

  if (command === "sandbox-check") {
    await checkSandbox(process.env.CODEX_HOME);
    return;
  }

  if (command === "agent") {
    const numbers = (args[0] ?? "")
      .split(",")
      .map((value) => Number(value))
      .filter((value) => Number.isInteger(value) && value > 0);
    const codexHome = process.env.CODEX_HOME;
    const model = process.env.CODEX_MODEL;
    const codex = new CodexRunner({
      codexHome,
      model,
      effort: process.env.CODEX_EFFORT,
      secrets: [...(await readAuthSecrets(join(codexHome, "auth.json"))), ...tokens.issued],
    });
    tokens.onIssue = (token) => codex.secrets.push(token);
    const root = join(tmpdir(), "codex-review-worktrees");
    await mkdir(root, { recursive: true });
    const worktrees = new Worktrees({ root });
    let failed = false;
    for (const number of numbers) {
      try {
        await processPullRequest({
          repo,
          codex,
          worktrees,
          number,
          runId: `${process.env.GITHUB_RUN_ID}-${process.env.GITHUB_RUN_ATTEMPT ?? "1"}`,
          runUrl,
          model: `${model} (${process.env.CODEX_EFFORT})`,
        });
      } catch (error) {
        failed = true;
        console.error(`::error::Codex agent failed on #${number}: ${error.message}`);
        const pr = await repo.pullRequest(number).catch(() => null);
        if (pr) {
          await repo
            .publishGate(
              pr,
              {
                state: "error",
                description: `${AGENT_FAILED}; comment /ai-review or re-add the label to retry`,
              },
              runUrl,
            )
            .catch(() => undefined);
        }
      }
    }
    if (failed) process.exitCode = 1;
    return;
  }

  throw new Error(
    "Usage: node .github/scripts/codex-review.mjs plan | sandbox-check | agent <numbers>",
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await main();
}
