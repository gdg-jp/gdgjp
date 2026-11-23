import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { type Job, toRunnerJob } from "./shared";

const GO_JOB = new URL("../../../../cli/internal/wiki/runner/jobs.go", import.meta.url);

function goJobFields(): Array<{ key: string; goType: string }> {
  const source = readFileSync(GO_JOB, "utf8");
  const body = /type Job struct \{([^}]*)\}/.exec(source)?.[1] ?? "";
  return [...body.matchAll(/^\s*\w+\s+(\S+)\s+`json:"([^",]+)/gm)].map(([, goType, key]) => ({
    key: key ?? "",
    goType: goType ?? "",
  }));
}

function decodesInto(goType: string, value: unknown): boolean {
  if (goType === "string") return typeof value === "string";
  if (goType === "int" || goType === "int64") return Number.isInteger(value);
  if (goType.startsWith("*")) return value === null || decodesInto(goType.slice(1), value);
  if (goType === "json.RawMessage") return value !== undefined;
  return false;
}

const job: Job = {
  id: "job_1",
  type: "plan",
  campaignId: 7,
  status: "leased",
  priority: 0,
  payload: { type: "plan", briefVersion: 1 },
  result: null,
  error: null,
  leaseOwner: "vm",
  leaseUntil: 1,
  attempts: 2,
  runAfter: 0,
  requestedBy: null,
  createdAt: 0,
  startedAt: 0,
  finishedAt: null,
};

describe("toRunnerJob", () => {
  it("decodes into the wiki runner client's Job that gdg pr runner reuses", () => {
    const fields = goJobFields();
    expect(fields.map((f) => f.key)).toContain("spaceId");
    const wire = JSON.parse(JSON.stringify(toRunnerJob(job))) as Record<string, unknown>;
    const mismatched = fields.filter(({ key, goType }) => !decodesInto(goType, wire[key]));
    expect(mismatched).toEqual([]);
    expect(wire.campaignId).toBe(7);
  });
});
