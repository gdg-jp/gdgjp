#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const SUMMARY_SCHEMA_VERSION = 1;
export const SUMMARY_JSON = "verification-summary.json";
export const SUMMARY_MARKDOWN = "verification-summary.md";
export const STATUSES = ["VERIFIED", "NOT VERIFIED", "INCONCLUSIVE"];

export const VERIFIERS = [
  {
    id: "acl-boundaries",
    label: "ACL bounded verification",
    skill: "verify-acl-boundaries",
    stateMachine: false,
    command: "node .agents/skills/verify-acl-boundaries/scripts/verify.mjs --mutation-proof",
  },
  {
    id: "job-lifecycle",
    label: "Runner lifecycle verification",
    skill: "verify-job-lifecycle",
    stateMachine: true,
    roles: ["production", "queue-constraints"],
    command: "node .agents/skills/verify-job-lifecycle/scripts/verify.mjs --mutation-proof",
  },
  {
    id: "accounts-client-revocation",
    label: "Accounts client revocation model (Alloy)",
    skill: "verify-accounts-client-revocation",
    stateMachine: true,
    command:
      "node .agents/skills/verify-accounts-client-revocation/scripts/verify.mjs --mutation-proof",
  },
];

export const SOURCES = [
  { id: "ci-metrics", label: "Local CI metrics (.turbo/ci-metrics)" },
  { id: "hosted-jobs", label: "Hosted CI jobs" },
  { id: "isolated-e2e", label: "Isolated E2E (isolated-e2e-result)" },
  ...VERIFIERS.map(({ id, label }) => ({ id, label })),
  { id: "mutation", label: "Mutation reports" },
  { id: "orca-journeys", label: "Orca journey evidence" },
];

export const SUMMARY_PRODUCERS = [
  /^scripts\/verification-summary\.mjs$/,
  /^scripts\/run-isolated-e2e\.mjs$/,
  /^scripts\/run-mutation\.mjs$/,
  /^scripts\/verification\//,
  /^\.github\/workflows\/ci\.yml$/,
  /^\.agents\/skills\/verify-[^/]+\/scripts\//,
];

const UI_FILE = /^(?:apps|packages)\/(?!cli\/)[^/]+\/.+\.(?:tsx|jsx|css|scss|html|svg)$/;
const UI_LOCALE = /^(?:apps|packages)\/(?!cli\/)[^/]+\/(?:.+\/)?locales?\/.+\.json$/;
const TEST_FILE =
  /(?:^|\/)(?:tests?|e2e|__tests__|__mocks__)\/|\.(?:test|spec)\.[cm]?[jt]sx?$|\.verification\./;
const STATE_MACHINE_FILE = /(?:^|[/._-])(?:state-?machine|statechart)(?:[/._-]|$)|\.als$/i;
const SCREENSHOT = /\.(?:png|jpe?g|webp|gif)$/i;
const RECORDING = /\.(?:webm|mp4|mov)$/i;
const SKIPPED_DIRECTORIES = new Set(["node_modules", ".git", "storage-state", "playwright-report"]);
const MAX_JSON_BYTES = 32 * 1024 * 1024;
export const MEDIA_LIMITS = {
  files: 100,
  fileBytes: 10 * 1024 * 1024,
  totalBytes: 60 * 1024 * 1024,
};

export function verifierCoverage(root) {
  const coverage = new Map();
  const add = (path, id) => {
    const ids = coverage.get(path) ?? [];
    if (!ids.includes(id)) ids.push(id);
    coverage.set(path, ids);
  };
  for (const verifier of VERIFIERS) {
    const file = join(root, ".agents/skills", verifier.skill, "coverage.json");
    if (!existsSync(file)) continue;
    const { sources = [] } = JSON.parse(readFileSync(file, "utf8"));
    for (const source of Array.isArray(sources) ? sources : Object.keys(sources)) {
      const path = typeof source === "string" ? source : source?.path;
      const role = typeof source === "string" ? null : source?.role;
      if (!path || (verifier.roles && !verifier.roles.includes(role))) continue;
      add(path, verifier.id);
    }
  }
  return coverage;
}

function modelVerifier(path) {
  const match = /^\.agents\/skills\/([^/]+)\/model\//.exec(path);
  return match ? VERIFIERS.find((verifier) => verifier.skill === match[1])?.id : undefined;
}

export function classifyChangedFiles(files, coverage = new Map()) {
  const ui = [];
  const stateMachine = [];
  const verifiers = {};
  for (const path of [...new Set(files)].sort()) {
    const test = TEST_FILE.test(path);
    if (!test && (UI_FILE.test(path) || UI_LOCALE.test(path))) ui.push(path);
    const covered = [...(coverage.get(path) ?? [])];
    const model = modelVerifier(path);
    if (model && !covered.includes(model)) covered.push(model);
    for (const id of covered) verifiers[id] = [...(verifiers[id] ?? []), path];
    const modeled = covered.some((id) => VERIFIERS.find((item) => item.id === id)?.stateMachine);
    if (modeled || (!test && STATE_MACHINE_FILE.test(path))) stateMachine.push(path);
  }
  return { files: files.length, ui, stateMachine, verifiers };
}

export function producersChanged(files) {
  return files.filter((path) => SUMMARY_PRODUCERS.some((pattern) => pattern.test(path)));
}

function sourceEntries(summary, id) {
  return summary?.sources?.find((source) => source.id === id)?.entries ?? [];
}

export function evidenceRequirements(changes, summary) {
  const requirements = [];
  if (changes.ui.length > 0) {
    const media = summary?.media ?? [];
    const journeys = sourceEntries(summary, "orca-journeys").filter(
      (entry) => entry.status === "VERIFIED",
    );
    requirements.push({
      id: "ui",
      label: "Screenshots or recordings of the changed UI, or a VERIFIED Orca journey",
      paths: changes.ui,
      satisfied: media.length > 0 || journeys.length > 0,
      evidence: [
        ...media.slice(0, 10).map((item) => item.path),
        ...journeys.slice(0, 10).map((entry) => entry.name),
      ],
    });
  }
  for (const verifier of VERIFIERS) {
    const paths = changes.verifiers[verifier.id];
    if (!paths?.length) continue;
    const verified = sourceEntries(summary, verifier.id).filter(
      (entry) => entry.status === "VERIFIED",
    );
    requirements.push({
      id: `verifier:${verifier.id}`,
      label: `${verifier.label} result (\`${verifier.command}\`)`,
      paths,
      satisfied: verified.length > 0,
      evidence: verified.map((entry) => entry.evidence).filter(Boolean),
    });
  }
  if (changes.stateMachine.length > 0) {
    requirements.push({
      id: "state-diagram",
      label: "State diagram of the changed states and transitions",
      paths: changes.stateMachine,
      satisfied: null,
      evidence: [],
    });
  }
  return requirements;
}

function readJson(file) {
  const { size } = statSync(file);
  if (size > MAX_JSON_BYTES) return undefined;
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return undefined;
  }
}

function walk(directory, skip, visit, rootDirectory = directory) {
  let entries;
  try {
    entries = readdirSync(directory, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const path = join(directory, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      if (SKIPPED_DIRECTORIES.has(entry.name) || skip.has(resolve(path))) continue;
      walk(path, skip, visit, rootDirectory);
    } else if (entry.isFile()) {
      visit(path, relative(rootDirectory, path).split(sep).join("/"));
    }
  }
}

function isoTime(value) {
  const time = typeof value === "number" ? value : Date.parse(value ?? "");
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

function modifiedAt(file) {
  return lstatSync(file).mtime.toISOString();
}

function entry(source, fields) {
  return { source, details: "", recordedAt: null, evidence: null, ...fields };
}

function ciMetricsEntries(record, evidence, recordedAt) {
  const entries = (record.steps ?? []).map((step) => {
    const tasks = (step.turboRuns ?? []).flatMap((run) => run.tasks ?? []);
    const hits = tasks.filter((task) => task.cache === "HIT").length;
    const notes = [`mode ${record.mode}`];
    if (Number.isFinite(step.durationMs)) notes.push(`${Math.round(step.durationMs / 1000)}s`);
    if (tasks.length > 0 && hits === tasks.length) notes.push("cached result");
    else if (hits > 0) notes.push(`${hits} of ${tasks.length} turbo tasks cached`);
    if (step.metricsError) notes.push(`metrics error: ${step.metricsError}`);
    return entry("ci-metrics", {
      name: step.name,
      status: step.exitCode === 0 ? "VERIFIED" : "NOT VERIFIED",
      details: notes.join("; "),
      recordedAt,
      evidence,
    });
  });
  for (const name of record.skippedSteps ?? []) {
    entries.push(
      entry("ci-metrics", {
        name,
        status: "NOT VERIFIED",
        details: `skipped by ${record.mode} run`,
        recordedAt,
        evidence,
      }),
    );
  }
  return entries;
}

function e2eEntry(record, evidence, recordedAt) {
  const counts = (record.reports ?? [])
    .map(({ workspace, counts }) =>
      counts
        ? `${workspace}: ${counts.passed} passed, ${counts.failed} failed, ${counts.skipped} skipped, ${counts.flaky} flaky`
        : `${workspace}: no Playwright report`,
    )
    .join("; ");
  const status = STATUSES.includes(record.status) ? record.status : "INCONCLUSIVE";
  const notes = [counts || "no reports"];
  if (record.scratchCleaned === false) notes.push("scratch cleanup incomplete");
  return entry("isolated-e2e", {
    name: (record.selected ?? []).join(", ") || "(no workspace selected)",
    status,
    details: notes.join("; "),
    recordedAt,
    evidence,
  });
}

function jobLifecycleEntry(record, evidence) {
  const status =
    record.status === "VERIFIED"
      ? "VERIFIED"
      : record.status === "STALE"
        ? "INCONCLUSIVE"
        : "NOT VERIFIED";
  const notes = [
    `verifier status ${record.status}`,
    record.mutationProof ? `${record.mutations?.length ?? 0} mutations` : "no mutation proof",
  ];
  if (record.sourceRevision) notes.push(`source ${String(record.sourceRevision).slice(0, 12)}`);
  if (record.error) notes.push(record.error);
  return entry("job-lifecycle", {
    name: "verify-job-lifecycle",
    status,
    details: notes.join("; "),
    recordedAt: isoTime(record.completedAt ?? record.startedAt),
    evidence,
  });
}

function aclEntry(record, evidence, recordedAt) {
  const status =
    record.verdict === "PASS"
      ? "VERIFIED"
      : record.verdict === "SOURCE REVIEW REQUIRED"
        ? "INCONCLUSIVE"
        : "NOT VERIFIED";
  const caught = (record.mutations ?? []).filter((item) => item.verdict === "CAUGHT").length;
  const notes = [`verdict ${record.verdict}`, `${caught} mutations caught`];
  if (record.head) notes.push(`head ${String(record.head).slice(0, 12)}`);
  if (record.sourceDrift?.length) notes.push(`${record.sourceDrift.length} drifted sources`);
  return entry("acl-boundaries", {
    name: "verify-acl-boundaries",
    status,
    details: notes.join("; "),
    recordedAt,
    evidence,
  });
}

function alloyEntry(record, evidence, recordedAt) {
  const status =
    record.exitCode === 0 ? "VERIFIED" : record.exitCode === 2 ? "INCONCLUSIVE" : "NOT VERIFIED";
  const detected = (record.mutations ?? []).filter((item) => item.detected).length;
  const notes = [
    `exit ${record.exitCode}`,
    `${record.checks?.length ?? 0} checks`,
    `${detected} of ${record.mutations?.length ?? 0} mutations detected`,
  ];
  if (record.openFindings?.length) notes.push(`open findings ${record.openFindings.join(", ")}`);
  if (record.sourceDrift?.length || record.anchorFailures?.length)
    notes.push("covered code drifted");
  return entry(record.verification, {
    name: `verify-${record.verification}`,
    status,
    details: notes.join("; "),
    recordedAt,
    evidence,
  });
}

const DETECTED = new Set(["Killed", "Timeout", "RuntimeError", "CompileError"]);
const UNDETECTED = new Set(["Survived", "NoCoverage"]);

function mutationEntry(record, evidence, recordedAt) {
  const counts = { detected: 0, undetected: 0, ignored: 0, pending: 0 };
  for (const file of Object.values(record.files ?? {})) {
    for (const mutant of file.mutants ?? []) {
      if (DETECTED.has(mutant.status)) counts.detected += 1;
      else if (UNDETECTED.has(mutant.status)) counts.undetected += 1;
      else if (mutant.status === "Ignored") counts.ignored += 1;
      else counts.pending += 1;
    }
  }
  const status =
    counts.undetected > 0 ? "NOT VERIFIED" : counts.detected > 0 ? "VERIFIED" : "INCONCLUSIVE";
  const project = evidence.includes("/.mutator/")
    ? evidence.slice(0, evidence.indexOf("/.mutator/"))
    : dirname(evidence);
  return entry("mutation", {
    name: project,
    status,
    details: `${counts.detected} detected, ${counts.undetected} undetected, ${counts.ignored} accepted, ${counts.pending} outside the selection`,
    recordedAt,
    evidence,
  });
}

function journeyEntries(record, evidence, recordedAt) {
  const journeys = Array.isArray(record) ? record : (record?.journeys ?? []);
  const directory = evidence.split("/");
  const skill = directory.includes("platform")
    ? "platform"
    : directory.includes("wiki")
      ? "wiki"
      : "orca";
  return journeys
    .filter((journey) => journey && typeof journey.id === "string")
    .map((journey) =>
      entry("orca-journeys", {
        name: `${skill}/${journey.id}`,
        status:
          journey.status === "VERIFIED"
            ? "VERIFIED"
            : journey.status === "INCONCLUSIVE"
              ? "INCONCLUSIVE"
              : "NOT VERIFIED",
        details: journey.failure
          ? `failure: ${typeof journey.failure === "string" ? journey.failure : JSON.stringify(journey.failure)}`
          : journey.status === "FAILED"
            ? "failed"
            : (journey.entryPoint ?? ""),
        recordedAt: isoTime(journey.observedAt) ?? recordedAt,
        evidence,
      }),
    );
}

export function classifyRecord(path, record, recordedAt) {
  const name = basename(path);
  const parent = basename(dirname(path));
  if (!record || typeof record !== "object") return [];
  if (/journeys\.json$/.test(name)) return journeyEntries(record, path, recordedAt);
  if (name === "mutation.json" && record.framework?.name === "mutator") {
    return [mutationEntry(record, path, recordedAt)];
  }
  if (parent === "ci-metrics" && Array.isArray(record.steps) && record.mode) {
    return ciMetricsEntries(record, path, isoTime(record.startedAtUnixMs) ?? recordedAt);
  }
  if (record.kind === "job-lifecycle-verification") return [jobLifecycleEntry(record, path)];
  if (
    VERIFIERS.some((verifier) => verifier.id === record.verification) &&
    String(record.tool ?? "").startsWith("Alloy")
  ) {
    return [alloyEntry(record, path, recordedAt)];
  }
  if (
    parent === "acl-boundaries" &&
    typeof record.verdict === "string" &&
    record.baseline !== undefined
  ) {
    return [aclEntry(record, path, recordedAt)];
  }
  if (
    name === "result.json" &&
    Array.isArray(record.selected) &&
    Array.isArray(record.reports) &&
    "scratchCleaned" in record
  ) {
    return [e2eEntry(record, path, recordedAt)];
  }
  return [];
}

function entryKey(item) {
  return item.source === "ci-metrics" ? item.source : `${item.source}\n${item.name}`;
}

function newest(entries) {
  const groups = new Map();
  for (const item of entries) {
    const key = entryKey(item);
    const time = Date.parse(item.recordedAt ?? "") || 0;
    const current = groups.get(key);
    if (!current || time > current.time) groups.set(key, { time, evidence: item.evidence });
  }
  return entries.filter((item) => groups.get(entryKey(item)).evidence === item.evidence);
}

export function hostedJobEntries(needs, evidence) {
  return Object.entries(needs ?? {})
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, job]) =>
      entry("hosted-jobs", {
        name,
        status: job?.result === "success" ? "VERIFIED" : "NOT VERIFIED",
        details:
          job?.result === "skipped"
            ? "skipped: not selected for this change"
            : `result ${job?.result ?? "unknown"}`,
        evidence,
      }),
    );
}

export function collectEvidence({ roots, since = null, skip = [] }) {
  const skipped = new Set(skip.map((path) => resolve(path)));
  const sinceTime = since === null ? null : Date.parse(since);
  const entries = [];
  const media = [];
  for (const root of roots) {
    walk(resolve(root.path), skipped, (file, path) => {
      const label = `${root.label}/${path}`;
      if (SCREENSHOT.test(file) || RECORDING.test(file)) {
        media.push({
          file,
          path: label,
          kind: SCREENSHOT.test(file) ? "screenshot" : "recording",
          bytes: statSync(file).size,
          recordedAt: modifiedAt(file),
        });
        return;
      }
      if (!file.endsWith(".json")) return;
      const name = basename(file);
      const parent = basename(dirname(file));
      const candidate =
        name === "result.json" ||
        name === "mutation.json" ||
        /journeys\.json$/.test(name) ||
        ["ci-metrics", "acl-boundaries", ...VERIFIERS.map((item) => item.id)].includes(parent);
      if (!candidate) return;
      entries.push(...classifyRecord(label, readJson(file), modifiedAt(file)));
    });
  }
  const recent = (item) =>
    sinceTime === null || (Date.parse(item.recordedAt ?? "") || 0) >= sinceTime;
  return {
    entries: newest(entries.filter(recent)),
    media: media.filter(recent).sort((a, b) => a.path.localeCompare(b.path)),
  };
}

function selectMedia(media) {
  const selected = [];
  let total = 0;
  for (const item of media) {
    if (selected.length >= MEDIA_LIMITS.files) break;
    if (item.bytes > MEDIA_LIMITS.fileBytes || total + item.bytes > MEDIA_LIMITS.totalBytes)
      continue;
    selected.push(item);
    total += item.bytes;
  }
  return selected;
}

const MISSING_REASONS = {
  "ci-metrics":
    "No local CI metrics. `pnpm ci:quick`, `pnpm ci:full`, or `pnpm ci:staged` writes them.",
  "hosted-jobs": "Not a hosted CI run.",
  "isolated-e2e": "No isolated E2E result. `pnpm test:e2e` writes one.",
  mutation: "No mutation report. `pnpm test:mutation -- --reporter json` writes one.",
  "orca-journeys": "No Orca journey records (`journeys.json`) from verify-platform or verify-wiki.",
};

export function buildSummary({
  commit,
  base = null,
  context,
  runUrl = null,
  changedFiles,
  coverage,
  entries,
  media,
  hostedJobs = null,
  generatedAt = new Date().toISOString(),
}) {
  const all = hostedJobs ? [...hostedJobEntries(hostedJobs, "hosted-jobs"), ...entries] : entries;
  const sources = SOURCES.map(({ id, label }) => {
    const items = all.filter((item) => item.source === id);
    const verifier = VERIFIERS.find((item) => item.id === id);
    return {
      id,
      label,
      found: items.length > 0,
      reason:
        items.length > 0
          ? null
          : (MISSING_REASONS[id] ?? `No result from \`${verifier?.command ?? id}\`.`),
      entries: items,
    };
  });
  const kept = selectMedia(media);
  const changes = classifyChangedFiles(changedFiles, coverage);
  const summary = {
    schemaVersion: SUMMARY_SCHEMA_VERSION,
    kind: "verification-summary",
    generatedAt,
    context,
    commit,
    base,
    runUrl,
    changes,
    producersChanged: producersChanged(changedFiles),
    sources,
    media: kept.map(({ file, ...item }) => ({ ...item, path: `media/${item.path}` })),
    mediaOmitted: media.length - kept.length,
  };
  summary.requirements = evidenceRequirements(changes, summary);
  return { summary, mediaFiles: kept };
}

export function cell(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("|", "\\|")
    .replaceAll(/\r?\n/g, " ")
    .slice(0, 300);
}

function code(value) {
  return `\`${String(value).replaceAll("`", "'").replaceAll(/\r?\n/g, " ").slice(0, 200)}\``;
}

function requirementState(requirement) {
  if (requirement.satisfied === true) return "PRESENT";
  if (requirement.satisfied === false) return "MISSING";
  return "ATTACH TO PR";
}

export function renderMarkdown(summary) {
  const lines = ["## Verification summary", ""];
  const header = [`Commit ${code(summary.commit?.slice(0, 12) ?? "unknown")}`];
  if (summary.base) header.push(`base ${code(summary.base.slice(0, 12))}`);
  header.push(`${summary.context} run`, `generated ${summary.generatedAt}`);
  if (summary.runUrl) header.push(`[workflow run](${summary.runUrl})`);
  lines.push(header.join(" · "), "");
  lines.push(
    "A missing source is not a pass. Each row reports a check or journey that actually ran and the result it recorded.",
    "",
  );
  if (summary.producersChanged.length > 0) {
    lines.push(
      `This change edits code that produces this summary (${summary.producersChanged.map(code).join(", ")}); read its results against the diff.`,
      "",
    );
  }
  lines.push("### Evidence this change needs", "");
  if (summary.requirements.length === 0) {
    lines.push("No UI, state-machine, or verifier-covered files changed.", "");
  } else {
    lines.push("| Requirement | Changed paths | State | Evidence |", "| --- | --- | --- | --- |");
    for (const requirement of summary.requirements) {
      const paths = requirement.paths.slice(0, 5).map(code).join(", ");
      const more = requirement.paths.length > 5 ? ` and ${requirement.paths.length - 5} more` : "";
      lines.push(
        `| ${cell(requirement.label)} | ${paths}${more} | ${requirementState(requirement)} | ${cell(requirement.evidence.slice(0, 3).join(", ")) || "none"} |`,
      );
    }
    lines.push("");
    if (summary.requirements.some((requirement) => requirement.satisfied === null)) {
      lines.push(
        "ATTACH TO PR: no tool records this evidence; put it in the pull request description.",
        "",
      );
    }
  }
  lines.push("### Results", "");
  if (summary.sources.every((source) => source.entries.length === 0)) {
    lines.push("No check or journey recorded a result.");
  } else {
    lines.push(
      "| Source | Check or journey | Result | Notes | Evidence |",
      "| --- | --- | --- | --- | --- |",
    );
  }
  for (const source of summary.sources) {
    for (const item of source.entries) {
      lines.push(
        `| ${cell(source.label)} | ${cell(item.name)} | ${item.status} | ${cell(item.details)} | ${item.evidence ? code(item.evidence) : ""} |`,
      );
    }
  }
  lines.push("", "### Missing sources", "");
  const missing = summary.sources.filter((source) => !source.found);
  if (missing.length === 0) lines.push("None.");
  for (const source of missing) lines.push(`- ${source.label}: MISSING. ${source.reason}`);
  lines.push("", "### Screenshots and recordings", "");
  if (summary.media.length === 0) lines.push("MISSING. No screenshots or recordings were found.");
  for (const item of summary.media.slice(0, 50)) lines.push(`- ${item.kind}: ${code(item.path)}`);
  if (summary.media.length > 50) lines.push(`- ${summary.media.length - 50} more in the artifact`);
  if (summary.mediaOmitted > 0) {
    lines.push(`- ${summary.mediaOmitted} files omitted by the size and count limits`);
  }
  lines.push("");
  return lines.join("\n");
}

export function writeSummary(output, summary, mediaFiles) {
  mkdirSync(output, { recursive: true });
  for (const item of mediaFiles) {
    const destination = join(output, "media", ...item.path.split("/"));
    mkdirSync(dirname(destination), { recursive: true });
    copyFileSync(item.file, destination);
  }
  writeFileSync(join(output, SUMMARY_JSON), `${JSON.stringify(summary, null, 2)}\n`);
  const markdown = renderMarkdown(summary);
  writeFileSync(join(output, SUMMARY_MARKDOWN), markdown);
  return markdown;
}

const usage = `usage: node scripts/verification-summary.mjs [options]

  --commit <sha>         commit the evidence describes (default: HEAD)
  --base <sha>           diff base for changed files (default: merge base with origin/main)
  --changed-files <file> newline-separated changed paths instead of git diff
  --evidence <dir>       extra evidence root, such as downloaded workflow artifacts (repeatable)
  --hosted-jobs <file>   JSON of hosted job results (toJSON(needs)); marks a hosted run
  --no-local             skip .turbo/ci-metrics and local_data/pstack
  --since <time>         ignore evidence recorded before this ISO time
  --run-url <url>        workflow run link for the summary
  --output <dir>         output directory (default: local_data/pstack/verification-summary/<time>)`;

export function parseArguments(args) {
  const options = { evidence: [], local: true };
  const valued = new Set([
    "--commit",
    "--base",
    "--changed-files",
    "--evidence",
    "--hosted-jobs",
    "--since",
    "--run-url",
    "--output",
  ]);
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--help" || argument === "-h") options.help = true;
    else if (argument === "--no-local") options.local = false;
    else if (valued.has(argument)) {
      const value = args[index + 1];
      if (value === undefined || value.startsWith("--")) {
        throw new Error(`${argument} requires a value`);
      }
      index += 1;
      if (argument === "--evidence") options.evidence.push(value);
      else
        options[argument.slice(2).replace(/-(\w)/g, (_, letter) => letter.toUpperCase())] = value;
    } else throw new Error(`Unknown argument: ${argument}\n${usage}`);
  }
  if (options.since !== undefined && !Number.isFinite(Date.parse(options.since))) {
    throw new Error(`--since is not a time: ${options.since}`);
  }
  return options;
}

function git(root, args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
}

function changedFiles(root, options, commit) {
  if (options.changedFiles) {
    return readFileSync(options.changedFiles, "utf8")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
  }
  const base = options.base ?? git(root, ["merge-base", "origin/main", commit]);
  return git(root, ["diff", "--name-only", "--no-renames", base, commit])
    .split("\n")
    .filter(Boolean);
}

export function main(args = process.argv.slice(2), root = process.cwd()) {
  const options = parseArguments(args);
  if (options.help) {
    console.log(usage);
    return 0;
  }
  const commit = options.commit ?? git(root, ["rev-parse", "HEAD"]);
  const files = changedFiles(root, options, commit);
  const generatedAt = new Date().toISOString();
  const output = resolve(
    root,
    options.output ??
      join("local_data/pstack/verification-summary", generatedAt.replaceAll(/[:.]/g, "-")),
  );
  const roots = [
    ...(options.local
      ? [
          { label: "ci-metrics", path: join(root, ".turbo/ci-metrics") },
          { label: "pstack", path: join(root, "local_data/pstack") },
        ]
      : []),
    ...options.evidence.map((path) => ({
      label: basename(resolve(root, path)),
      path: resolve(root, path),
    })),
  ];
  const { entries, media } = collectEvidence({
    roots,
    since: options.since ?? null,
    skip: [
      output,
      join(root, "local_data/pstack/verification-summary"),
      join(root, "local_data/pstack/tools"),
    ],
  });
  const { summary, mediaFiles } = buildSummary({
    commit,
    base: options.base ?? null,
    context: options.hostedJobs ? "hosted" : "local",
    runUrl: options.runUrl ?? null,
    changedFiles: files,
    coverage: verifierCoverage(root),
    entries,
    media,
    hostedJobs: options.hostedJobs ? JSON.parse(readFileSync(options.hostedJobs, "utf8")) : null,
    generatedAt,
  });
  writeSummary(output, summary, mediaFiles);
  console.log(`verification-summary=${join(output, SUMMARY_MARKDOWN)}`);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
