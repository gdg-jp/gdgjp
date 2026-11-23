import { describe, expect, it } from "vitest";
import { buildBenchFixture } from "./fixtures";
import { solve } from "./solve";

describe("solver scale bench", () => {
  it("solves the 100 staff x 60 slots x 10 roles x 4 tracks scale within budget", () => {
    const input = buildBenchFixture();

    const start = performance.now();
    const { assignments, report } = solve(input);
    const elapsedMs = performance.now() - start;

    console.log(
      `[solver.bench] 100x60x10x4: ${elapsedMs.toFixed(1)}ms, ` +
        `assigned=${report.metrics.assigned}, ` +
        `minShortage=${report.metrics.minShortage}, ` +
        `leadShortage=${report.metrics.leadShortage}, ` +
        `violations=${report.metrics.violationCount}`,
    );

    expect(assignments.size).toBeGreaterThan(0);
    expect(elapsedMs).toBeLessThan(10_000);
  });
});
