import type { JobStatus } from "./types";

const LEGAL_TRANSITIONS: Record<JobStatus, readonly JobStatus[]> = {
  // A queued job can start running, or fail outright before it ever runs
  // (e.g. the queue send that would have delivered it failed).
  queued: ["running", "failed"],
  running: ["succeeded", "failed"],
  succeeded: [],
  failed: [],
};

export function canTransitionJob(from: JobStatus, to: JobStatus): boolean {
  return LEGAL_TRANSITIONS[from].includes(to);
}

export function isTerminalJobStatus(status: JobStatus): boolean {
  return status === "succeeded" || status === "failed";
}
