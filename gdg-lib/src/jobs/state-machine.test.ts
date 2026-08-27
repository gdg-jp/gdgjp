import { describe, expect, it } from "vitest";
import { canTransitionJob, isTerminalJobStatus } from "./state-machine";
import type { JobStatus } from "./types";

const ALL_STATUSES: JobStatus[] = ["queued", "running", "succeeded", "failed"];

describe("canTransitionJob", () => {
  it.each([
    ["queued", "running"],
    ["queued", "failed"],
    ["running", "succeeded"],
    ["running", "failed"],
  ] satisfies Array<[JobStatus, JobStatus]>)("allows %s -> %s", (from, to) => {
    expect(canTransitionJob(from, to)).toBe(true);
  });

  it.each([
    ["queued", "succeeded"],
    ["queued", "queued"],
    ["running", "queued"],
    ["running", "running"],
    ["succeeded", "queued"],
    ["succeeded", "running"],
    ["succeeded", "failed"],
    ["succeeded", "succeeded"],
    ["failed", "queued"],
    ["failed", "running"],
    ["failed", "succeeded"],
    ["failed", "failed"],
  ] satisfies Array<[JobStatus, JobStatus]>)("rejects %s -> %s", (from, to) => {
    expect(canTransitionJob(from, to)).toBe(false);
  });

  it("covers every status pair exhaustively", () => {
    for (const from of ALL_STATUSES) {
      for (const to of ALL_STATUSES) {
        expect(typeof canTransitionJob(from, to)).toBe("boolean");
      }
    }
  });
});

describe("isTerminalJobStatus", () => {
  it("treats succeeded and failed as terminal", () => {
    expect(isTerminalJobStatus("succeeded")).toBe(true);
    expect(isTerminalJobStatus("failed")).toBe(true);
  });

  it("treats queued and running as non-terminal", () => {
    expect(isTerminalJobStatus("queued")).toBe(false);
    expect(isTerminalJobStatus("running")).toBe(false);
  });
});
