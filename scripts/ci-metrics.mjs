import { readFileSync } from "node:fs";

export const playwrightReport = ".turbo/ci-playwright.json";

export function turboMetrics(output) {
  // Only read summaries named by this process, not other CI runs in the checkout.
  const paths = [...new Set(output.match(/\.turbo\/runs\/[\w-]+\.json/g) ?? [])];
  return paths.map((path) => {
    const summary = JSON.parse(readFileSync(path, "utf8"));
    return {
      id: summary.id,
      execution: summary.execution,
      tasks: summary.tasks.map((task) => ({
        taskId: task.taskId,
        execution: task.execution,
        durationMs: task.execution ? task.execution.endTime - task.execution.startTime : null,
        cache: task.cache.status,
      })),
    };
  });
}

export function playwrightMetrics(directory, startedAtUnixMs, cached = false) {
  const path = `${directory}/${playwrightReport}`;
  let report;
  try {
    report = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return undefined;
    throw error;
  }
  // A process that failed before Playwright started must not reuse an old result.
  if (!cached && Date.parse(report.stats.startTime) < startedAtUnixMs) return undefined;
  const tests = [];
  function visit(suite) {
    for (const spec of suite.specs ?? []) {
      for (const test of spec.tests) {
        for (const result of test.results) {
          tests.push({
            file: spec.file,
            title: spec.title,
            project: test.projectName,
            status: result.status,
            retry: result.retry,
            startedAtUnixMs: Date.parse(result.startTime),
            durationMs: result.duration,
          });
        }
      }
    }
    for (const child of suite.suites ?? []) visit(child);
  }
  for (const suite of report.suites) visit(suite);
  const starts = tests.map((test) => test.startedAtUnixMs).filter(Number.isFinite);
  return {
    directory,
    cached,
    durationMs: report.stats.duration,
    // Includes discovery, server startup and global setup before the first test.
    firstTestDelayMs: starts.length
      ? Math.min(...starts) - Date.parse(report.stats.startTime)
      : null,
    counts: {
      passed: report.stats.expected,
      failed: report.stats.unexpected,
      skipped: report.stats.skipped,
      flaky: report.stats.flaky,
    },
    tests,
  };
}
