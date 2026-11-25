import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

function object(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value;
}

function time(value, label) {
  if (typeof value !== "string" || !/T.*(?:Z|[+-]\d\d:\d\d)$/.test(value)) {
    throw new Error(`${label} must be an ISO timestamp with a timezone`);
  }
  const result = Date.parse(value);
  if (!Number.isFinite(result)) throw new Error(`${label} is invalid`);
  return result;
}

function number(value, label, integer = false) {
  if (!Number.isFinite(value) || value < 0 || (integer && !Number.isInteger(value))) {
    throw new Error(`${label} must be a nonnegative ${integer ? "integer" : "number"}`);
  }
  return value;
}

function array(value, label) {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  return value;
}

function distribution(values) {
  const sorted = [...values].sort((a, b) => a - b);
  if (!sorted.length) return { sampleCount: 0, median: null, min: null, max: null };
  const middle = Math.floor(sorted.length / 2);
  return {
    sampleCount: sorted.length,
    median: sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2,
    min: sorted[0],
    max: sorted.at(-1),
  };
}

function envelope(input, label, now, maxAgeMs) {
  if (input === undefined || input === null) {
    return { status: "unavailable", source: null, collectedAt: null, ageMs: null };
  }
  object(input, label);
  const collected = time(input.collectedAt, `${label}.collectedAt`);
  if (collected > now) throw new Error(`${label}.collectedAt is in the future`);
  return {
    status: now - collected > maxAgeMs ? "stale" : "available",
    source: typeof input.source === "string" ? input.source : null,
    collectedAt: new Date(collected).toISOString(),
    ageMs: now - collected,
  };
}

function measuredFreshness(metadata, observations, now, maxAgeMs) {
  const latest = observations.length ? Math.max(...observations) : null;
  return {
    ...metadata,
    status: latest !== null && now - latest > maxAgeMs ? "stale" : metadata.status,
    latestObservationAt: latest === null ? null : new Date(latest).toISOString(),
    observationAgeMs: latest === null ? null : now - latest,
  };
}

function deploymentObservations(input, metadata, within, now, maxAgeMs) {
  if (input.complete !== undefined && typeof input.complete !== "boolean") {
    throw new Error("deployRuns.complete must be a boolean");
  }
  const counts = {
    successful: 0,
    failed: 0,
    cancelled: 0,
    queued: 0,
    inProgress: 0,
    incomplete: 0,
    skipped: 0,
    neutral: 0,
    other: 0,
  };
  const attempts = [];
  for (const raw of array(input.workflow_runs, "deployRuns.workflow_runs")) {
    const run = object(raw, "deployment run");
    const created = time(run.created_at, "deployment run.created_at");
    if (!within(created)) continue;
    if (typeof run.status !== "string") throw new Error("deployment run.status is missing");
    let outcome;
    if (["queued", "requested", "waiting", "pending"].includes(run.status)) outcome = "queued";
    else if (run.status === "in_progress") outcome = "inProgress";
    else if (run.status !== "completed") outcome = "incomplete";
    else if (run.conclusion === "success") outcome = "successful";
    else if (
      ["failure", "timed_out", "startup_failure", "action_required"].includes(run.conclusion)
    )
      outcome = "failed";
    else if (run.conclusion === "cancelled") outcome = "cancelled";
    else if (run.conclusion === "skipped") outcome = "skipped";
    else if (run.conclusion === "neutral") outcome = "neutral";
    else outcome = "other";
    counts[outcome]++;
    attempts.push({
      id: run.id ?? null,
      sha: run.head_sha ?? null,
      createdAt: new Date(created).toISOString(),
      outcome,
      url: run.html_url ?? null,
    });
  }
  const totalAvailable =
    input.total_count === undefined
      ? null
      : number(input.total_count, "deployRuns.total_count", true);
  return {
    ...measuredFreshness(
      metadata,
      attempts.map((run) => Date.parse(run.createdAt)),
      now,
      maxAgeMs,
    ),
    unit: "workflow attempts, not per-application releases",
    returnedRunCount: input.workflow_runs.length,
    totalAvailable,
    complete:
      input.complete ?? (totalAvailable !== null && totalAvailable <= input.workflow_runs.length),
    windowAttemptCount: attempts.length,
    counts,
    attempts,
    deploymentFailureRate: null,
  };
}

function ciObservations(input, metadata, within, now, maxAgeMs) {
  const counts = { passed: 0, failed: 0, cancelled: 0, incomplete: 0, partial: 0 };
  const browser = {
    reportCount: 0,
    missingReportCount: 0,
    passed: 0,
    failed: 0,
    skipped: 0,
    flaky: 0,
    cachedReports: 0,
  };
  const durations = { passed: [], failed: [], cancelled: [], incomplete: [], partial: [] };
  const runs = [];
  let skippedSteps = 0;
  let cachedTasks = 0;
  let uncachedTasks = 0;
  for (const raw of array(input.runs, "ciRuns.runs")) {
    const run = object(raw, "CI run");
    const started = number(run.startedAtUnixMs, "CI run.startedAtUnixMs");
    if (!within(started)) continue;
    if (run.exitCode !== undefined && run.exitCode !== null && !Number.isInteger(run.exitCode))
      throw new Error("CI run.exitCode must be an integer or null");
    const skipped = array(run.skippedSteps ?? [], "CI run.skippedSteps").length;
    const steps = array(run.steps ?? [], "CI run.steps");
    const interrupted =
      ["SIGINT", "SIGTERM"].includes(run.signal) ||
      steps.some((step) => ["SIGINT", "SIGTERM"].includes(step.signal));
    const hasExecutedSteps = steps.some((step) => Number.isInteger(step.exitCode));
    const failedStep = steps.some((step) => Number.isInteger(step.exitCode) && step.exitCode !== 0);
    const outcome = interrupted
      ? "cancelled"
      : run.exitCode == null
        ? "incomplete"
        : run.exitCode !== 0 || failedStep
          ? "failed"
          : !hasExecutedSteps || steps.some((step) => step.exitCode == null)
            ? "incomplete"
            : skipped
              ? "partial"
              : "passed";
    counts[outcome]++;
    skippedSteps += skipped;
    if (run.durationMs != null)
      durations[outcome].push(number(run.durationMs, "CI run.durationMs"));
    const tasks = new Map();
    for (const summary of run.turboRuns ?? steps.flatMap((step) => step.turboRuns ?? [])) {
      for (const task of array(summary.tasks, "Turbo tasks"))
        tasks.set(`${summary.id}:${task.taskId}`, task);
    }
    for (const task of tasks.values()) {
      if (task.cache === "HIT") cachedTasks++;
      else uncachedTasks++;
    }
    for (const step of steps) {
      if (step.name?.startsWith("e2e") && !step.playwright?.length) browser.missingReportCount++;
      for (const report of array(step.playwright ?? [], "CI step.playwright")) {
        browser.reportCount++;
        object(report.counts, "browser counts");
        for (const key of ["passed", "failed", "skipped", "flaky"])
          browser[key] += number(report.counts[key], `browser counts.${key}`, true);
        if (report.cached === true) browser.cachedReports++;
      }
    }
    runs.push({
      source: run.source ?? null,
      startedAt: new Date(started).toISOString(),
      outcome,
      exitCode: run.exitCode ?? null,
      skippedStepCount: skipped,
    });
  }
  return {
    ...measuredFreshness(
      metadata,
      runs.map((run) => Date.parse(run.startedAt)),
      now,
      maxAgeMs,
    ),
    runCount: runs.length,
    counts,
    skippedStepCount: skippedSteps,
    cachedTaskCount: cachedTasks,
    uncachedTaskCount: uncachedTasks,
    browserCounts: browser,
    runDurationMs: Object.fromEntries(
      Object.entries(durations).map(([key, values]) => [key, distribution(values)]),
    ),
    runs,
  };
}

function navigationObservations(input, metadata, within, kind, now, maxAgeMs) {
  if (input.kind !== kind)
    throw new Error(`Expected ${kind} input; observations cannot be relabeled`);
  const successes = [];
  const failures = [];
  for (const raw of array(input.samples, `${kind}.samples`)) {
    const sample = object(raw, `${kind} sample`);
    const observed = time(sample.observedAt, "navigation observedAt");
    const url = new URL(sample.url);
    if (!["http:", "https:"].includes(url.protocol))
      throw new Error("navigation URL must use HTTP");
    if (
      kind === "production-rum" &&
      (sample.synthetic === true ||
        ["localhost", "0.0.0.0", "[::1]", "[::]"].includes(url.hostname) ||
        url.hostname.startsWith("127.") ||
        url.hostname.endsWith(".localhost"))
    )
      throw new Error("Production RUM cannot contain synthetic or localhost observations");
    if (!["success", "failed"].includes(sample.outcome))
      throw new Error("navigation outcome must be success or failed");
    if (typeof sample.evidence !== "string" || !sample.evidence.trim())
      throw new Error("navigation evidence is required");
    if (
      sample.httpStatus !== undefined &&
      (!Number.isInteger(sample.httpStatus) || sample.httpStatus < 100 || sample.httpStatus > 599)
    )
      throw new Error("navigation httpStatus is invalid");
    if (sample.outcome === "success" && sample.httpStatus >= 400)
      throw new Error("An HTTP error cannot be a successful navigation");
    if (!within(observed)) continue;
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    const record = {
      observedAt: new Date(observed).toISOString(),
      url: url.href,
      httpStatus: sample.httpStatus ?? null,
      evidence: sample.evidence,
    };
    if (sample.outcome === "failed") failures.push(record);
    else {
      const navigation = object(sample.navigation, "navigation timing");
      const duration = number(navigation.duration, "navigation.duration");
      if (duration === 0)
        throw new Error("Successful navigation must have completed timing, not zero duration");
      successes.push({
        ...record,
        durationMs: duration,
        responseStartMs: number(navigation.responseStart, "navigation.responseStart"),
        domContentLoadedMs: number(
          navigation.domContentLoadedEventEnd,
          "navigation.domContentLoadedEventEnd",
        ),
        loadEventEndMs: number(navigation.loadEventEnd, "navigation.loadEventEnd"),
      });
    }
  }
  return {
    ...measuredFreshness(
      metadata,
      [...successes, ...failures].map((sample) => Date.parse(sample.observedAt)),
      now,
      maxAgeMs,
    ),
    kind,
    sampleCount: successes.length + failures.length,
    successfulSampleCount: successes.length,
    failedSampleCount: failures.length,
    timingMs: Object.fromEntries(
      ["durationMs", "responseStartMs", "domContentLoadedMs", "loadEventEndMs"].map((field) => [
        field,
        distribution(successes.map((sample) => sample[field])),
      ]),
    ),
    successes,
    failures,
    comparisonVerdict: "not evaluated",
  };
}

const RUM_METRICS = ["ttfbMs", "fcpMs", "lcpMs", "inpMs", "cls"];
const RUM_PERCENTILES = ["p50", "p75", "p90", "p99"];

function productionHost(value, label) {
  if (
    typeof value !== "string" ||
    !/^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/.test(value) ||
    value.endsWith(".localhost") ||
    /^\d+(?:\.\d+){3}$/.test(value)
  )
    throw new Error(`${label} must be a production hostname`);
  return value;
}

function aggregateRumObservations(input, metadata, window, now, maxAgeMs) {
  if (input.kind !== "production-rum")
    throw new Error("Expected production-rum input; observations cannot be relabeled");
  const range = object(input.window, "productionRum.window");
  const since = time(range.since, "productionRum.window.since");
  const until = time(range.until, "productionRum.window.until");
  if (since > until) throw new Error("productionRum.window must satisfy since <= until");
  if (input.synthetic === true) throw new Error("Production RUM cannot be synthetic");
  const apps = array(input.apps, "productionRum.apps").map((raw) => {
    const entry = object(raw, "production RUM app");
    if (typeof entry.app !== "string" || !/^[a-z0-9-]+$/.test(entry.app))
      throw new Error("production RUM app name is invalid");
    if (entry.synthetic === true) throw new Error("Production RUM cannot be synthetic");
    const metrics = object(entry.metrics, "production RUM metrics");
    return {
      app: entry.app,
      host: productionHost(entry.host, "production RUM host"),
      pageViews: number(entry.pageViews, "production RUM pageViews"),
      visits: entry.visits === undefined ? null : number(entry.visits, "production RUM visits"),
      sampleInterval:
        entry.sampleInterval === undefined
          ? null
          : number(entry.sampleInterval, "production RUM sampleInterval"),
      metrics: Object.fromEntries(
        RUM_METRICS.map((name) => {
          const value = object(metrics[name], `production RUM metrics.${name}`);
          const sampleCount = number(value.sampleCount, `${name}.sampleCount`);
          return [
            name,
            {
              sampleCount,
              ...Object.fromEntries(
                RUM_PERCENTILES.map((percentile) => {
                  const raw = value[percentile];
                  if (raw === null || raw === undefined) return [percentile, null];
                  if (sampleCount === 0)
                    throw new Error(`${name}.${percentile} requires a nonzero sample count`);
                  return [percentile, number(raw, `${name}.${percentile}`)];
                }),
              ),
            },
          ];
        }),
      ),
    };
  });
  const windowMatchesReport = since === window.start && until === window.end;
  const windowEndAgeMs = now - until;
  return {
    ...metadata,
    status: windowEndAgeMs > maxAgeMs ? "stale" : metadata.status,
    kind: "production-rum",
    format: "aggregate",
    window: {
      since: new Date(since).toISOString(),
      until: new Date(until).toISOString(),
      inclusive: true,
    },
    windowMatchesReport,
    windowEndAgeMs,
    sampling: typeof input.sampling === "string" ? input.sampling : null,
    privacy: typeof input.privacy === "string" ? input.privacy : null,
    appCount: apps.length,
    pageViews: apps.reduce((total, entry) => total + entry.pageViews, 0),
    excludedHostCount:
      input.excludedHostCount === undefined
        ? null
        : number(input.excludedHostCount, "productionRum.excludedHostCount", true),
    apps,
    comparisonVerdict: "not evaluated",
  };
}

function appOf(path) {
  const match = /^apps\/([^/]+)\//.exec(path);
  return match ? match[1] : null;
}

function deliveryAndPerformance(report, filtered, explicitReverts) {
  const withPaths = filtered.every((commit) => Array.isArray(commit.paths));
  const perApp = new Map();
  const row = (app) => {
    if (!perApp.has(app))
      perApp.set(app, {
        app,
        commits: withPaths ? 0 : null,
        explicitReverts: withPaths ? 0 : null,
        production: null,
      });
    return perApp.get(app);
  };
  if (withPaths) {
    const reverts = new Set(explicitReverts.map((commit) => commit.sha));
    for (const commit of filtered) {
      for (const app of new Set(commit.paths.map(appOf).filter(Boolean))) {
        row(app).commits++;
        if (reverts.has(commit.sha)) row(app).explicitReverts++;
      }
    }
  }
  const rum = report.productionRum;
  const rumUsable = rum.format === "aggregate" && rum.windowMatchesReport;
  if (rumUsable) {
    for (const entry of rum.apps) {
      const target = row(entry.app);
      target.production ??= [];
      target.production.push({
        host: entry.host,
        pageViews: entry.pageViews,
        sampleInterval: entry.sampleInterval,
        ...Object.fromEntries(
          RUM_METRICS.map((name) => [
            name,
            { p75: entry.metrics[name].p75, sampleCount: entry.metrics[name].sampleCount },
          ]),
        ),
      });
    }
  }
  const deploy = report.deployRuns;
  return {
    window: report.window,
    causality:
      "Not inferred. Rows place independently measured throughput, explicit reverts, and production performance in the same window",
    throughput: {
      commits: filtered.length,
      explicitReverts: explicitReverts.length,
      deployAttempts: deploy.status === "unavailable" ? null : deploy.windowAttemptCount,
      deployAttemptsUnit: "workflow attempts across all applications, not per-application releases",
      deploySource: { status: deploy.status, complete: deploy.complete ?? null },
      perAppCommitBasis: withPaths
        ? "commits whose changed paths include apps/<app>/; one commit can count for several apps; merge commits list no paths"
        : "unavailable: commit paths were not supplied",
    },
    production: {
      status: rum.status,
      source: rum.source,
      collectedAt: rum.collectedAt,
      ageMs: rum.ageMs,
      windowEndAgeMs: rum.windowEndAgeMs ?? null,
      windowMatchesReport: rum.windowMatchesReport ?? null,
      sampling: rum.sampling ?? null,
      basis: rumUsable
        ? "p75 per host from production RUM for the report window"
        : rum.status === "unavailable"
          ? "unavailable"
          : rum.format !== "aggregate"
            ? "not shown: per-sample production RUM is reported separately"
            : "not shown: production RUM window differs from the report window",
    },
    apps: [...perApp.values()].sort((a, b) => a.app.localeCompare(b.app)),
  };
}

export function aggregateEngineeringHealth({
  since,
  until,
  now,
  maxAgeMs = 86_400_000,
  commits,
  deployRuns,
  ciRuns,
  syntheticNavigation,
  productionRum,
}) {
  const start = time(since, "since");
  const end = time(until, "until");
  const generated = time(now, "now");
  number(maxAgeMs, "maxAgeMs");
  if (start > end || end > generated) throw new Error("Window must satisfy since <= until <= now");
  const within = (value) => value >= start && value <= end;
  const filtered = array(commits, "commits")
    .map((raw) => {
      const commit = object(raw, "commit");
      if (
        typeof commit.sha !== "string" ||
        !/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/.test(commit.sha) ||
        typeof commit.subject !== "string"
      )
        throw new Error("Commit SHA or subject is invalid");
      if (
        commit.paths !== undefined &&
        !array(commit.paths, "commit.paths").every((path) => typeof path === "string")
      )
        throw new Error("commit.paths must contain strings");
      return { ...commit, timestamp: time(commit.committedAt, "commit.committedAt") };
    })
    .filter((commit) => within(commit.timestamp));
  const explicitReverts = filtered.filter((commit) => /^revert(?:\b|\()/i.test(commit.subject));
  const report = {
    schemaVersion: 1,
    reportType: "engineering-health",
    generatedAt: new Date(generated).toISOString(),
    window: {
      since: new Date(start).toISOString(),
      until: new Date(end).toISOString(),
      inclusive: true,
    },
    maxAgeMs,
    commits: {
      status: "available",
      source: "local git history reachable from HEAD",
      count: filtered.length,
      explicitRevertCount: explicitReverts.length,
      explicitReverts: explicitReverts.map(({ sha, committedAt, subject }) => ({
        sha,
        committedAt,
        subject,
      })),
      semanticRevertCount: null,
      releaseRevertRate: null,
    },
  };
  for (const [name, input] of Object.entries({
    deployRuns,
    ciRuns,
    syntheticNavigation,
    productionRum,
  })) {
    const metadata = envelope(input, name, generated, maxAgeMs);
    report[name] =
      metadata.status === "unavailable"
        ? metadata
        : name === "deployRuns"
          ? deploymentObservations(input, metadata, within, generated, maxAgeMs)
          : name === "ciRuns"
            ? ciObservations(input, metadata, within, generated, maxAgeMs)
            : name === "productionRum" && input.format === "aggregate"
              ? aggregateRumObservations(input, metadata, { start, end }, generated, maxAgeMs)
              : navigationObservations(
                  input,
                  metadata,
                  within,
                  name === "syntheticNavigation" ? "synthetic-navigation" : "production-rum",
                  generated,
                  maxAgeMs,
                );
  }
  report.gaps = Object.entries(report)
    .filter(([, value]) => value?.status === "unavailable" || value?.status === "stale")
    .map(([name, value]) => `${name}: ${value.status}`);
  if (report.deployRuns.complete === false)
    report.gaps.push("deployRuns: pagination coverage is incomplete or unknown");
  if (report.productionRum.windowMatchesReport === false)
    report.gaps.push("productionRum: window differs from the report window");
  report.deliveryAndPerformance = deliveryAndPerformance(report, filtered, explicitReverts);
  report.status = report.gaps.length ? "NOT VERIFIED" : "VERIFIED";
  report.statusBasis =
    "Input availability and freshness only; outcomes remain separate and are not deployment approval";
  return report;
}

const help = `Usage: node scripts/engineering-health.mjs --since ISO [options]
  --until ISO                    Window end, defaults to --now
  --now ISO                      Observation time, defaults to current UTC
  --max-age-hours HOURS          Input freshness limit, defaults to 24
  --repo PATH                    Local Git checkout, defaults to current directory
  --deploy-runs PATH             {collectedAt, source, workflow_runs, total_count?, complete?}
  --ci-metrics-dir PATH          Existing local CI JSON run directory
  --synthetic-navigation PATH    {kind:"synthetic-navigation", collectedAt, source, samples}
  --production-rum PATH          {kind:"production-rum", collectedAt, source, samples} or
                                 {kind:"production-rum", format:"aggregate", collectedAt,
                                  source, window:{since,until}, apps}
  --output PATH                  Write report JSON instead of stdout
Navigation sample: {observedAt,url,outcome:"success"|"failed",httpStatus?,evidence,
 navigation:{duration,responseStart,domContentLoadedEventEnd,loadEventEnd}}
Aggregate RUM app: {app,host,pageViews,visits?,sampleInterval?,
 metrics:{ttfbMs,fcpMs,lcpMs,inpMs,cls each {sampleCount,p50,p75,p90,p99}}}
Production RUM appears beside throughput only when its window equals the report window.
Missing inputs produce NOT VERIFIED coverage. Malformed inputs fail with exit code 1.
This command reads local files and Git only; it never fetches or changes external state.\n`;

export function run(args = process.argv.slice(2)) {
  const options = {};
  const names = new Set([
    "since",
    "until",
    "now",
    "max-age-hours",
    "repo",
    "deploy-runs",
    "ci-metrics-dir",
    "synthetic-navigation",
    "production-rum",
    "output",
  ]);
  for (let index = 0; index < args.length; index++) {
    if (args[index] === "--help") {
      process.stdout.write(help);
      return;
    }
    const name = args[index].slice(2);
    if (
      !args[index].startsWith("--") ||
      !names.has(name) ||
      !args[index + 1] ||
      args[index + 1].startsWith("--") ||
      Object.hasOwn(options, name)
    )
      throw new Error(`Invalid or duplicate argument: ${args[index]}`);
    options[name] = args[++index];
  }
  if (!options.since) throw new Error("--since is required");
  const now = options.now ?? new Date().toISOString();
  const until = options.until ?? now;
  const repository = resolve(options.repo ?? process.cwd());
  const output = execFileSync(
    "git",
    [
      "log",
      "--format=%x1e%H%x00%cI%x00%s",
      "--name-only",
      `--since-as-filter=${options.since}`,
      `--until=${until}`,
    ],
    { cwd: repository, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 },
  );
  const commits = output
    .split("\x1e")
    .filter((record) => record.trim())
    .map((record) => {
      const [header, ...paths] = record.split("\n");
      const [sha, committedAt, subject] = header.split("\0");
      return { sha, committedAt, subject, paths: paths.filter(Boolean) };
    });
  const read = (flag) =>
    options[flag] ? JSON.parse(readFileSync(resolve(options[flag]), "utf8")) : undefined;
  const ciRuns = options["ci-metrics-dir"]
    ? {
        collectedAt: now,
        source: resolve(options["ci-metrics-dir"]),
        runs: readdirSync(resolve(options["ci-metrics-dir"]))
          .filter((name) => name.endsWith(".json"))
          .sort()
          .map((name) => ({
            ...JSON.parse(readFileSync(resolve(options["ci-metrics-dir"], name), "utf8")),
            source: name,
          })),
      }
    : undefined;
  const report = aggregateEngineeringHealth({
    since: options.since,
    until,
    now,
    maxAgeMs:
      options["max-age-hours"] === undefined
        ? 86_400_000
        : Number(options["max-age-hours"]) * 3_600_000,
    commits,
    deployRuns: read("deploy-runs"),
    ciRuns,
    syntheticNavigation: read("synthetic-navigation"),
    productionRum: read("production-rum"),
  });
  const json = `${JSON.stringify(report, null, 2)}\n`;
  if (options.output) {
    const destination = resolve(options.output);
    if (
      existsSync(destination) &&
      JSON.parse(readFileSync(destination, "utf8")).reportType !== "engineering-health"
    )
      throw new Error("Refusing to replace a file that is not an engineering health report");
    mkdirSync(dirname(destination), { recursive: true });
    const temporary = `${destination}.${process.pid}.tmp`;
    writeFileSync(temporary, json, { flag: "wx" });
    renameSync(temporary, destination);
  } else process.stdout.write(json);
  return report;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    run();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
