import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { SLOTS, slotFromLabel } from "./lib.mjs";

export function selectTargets({
  event,
  action,
  label,
  pr,
  headSha,
  headRepo,
  repo,
  mainSha,
  current,
}) {
  if (event === "pull_request" && action === "labeled") {
    const slot = slotFromLabel(label);
    if (!slot || headRepo !== repo || !headSha) return [];
    return [{ slot, ref: headSha, pr: String(pr) }];
  }
  if (event === "pull_request" && action === "closed")
    return SLOTS.filter((slot) => current[slot]?.pr === String(pr)).map((slot) => ({
      slot,
      ref: mainSha,
      pr: "",
    }));
  if (event === "push")
    return SLOTS.filter((slot) => !current[slot]?.pr).map((slot) => ({
      slot,
      ref: mainSha,
      pr: "",
    }));
  if (event === "schedule" || event === "workflow_dispatch")
    return SLOTS.map((slot) =>
      current[slot]?.pr
        ? { slot, ref: current[slot].sha, pr: current[slot].pr }
        : { slot, ref: mainSha, pr: "" },
    );
  return [];
}

function currentDeployments(repo) {
  const current = {};
  for (const slot of SLOTS) {
    const [latest] = JSON.parse(
      execFileSync("gh", ["api", `repos/${repo}/deployments?environment=${slot}&per_page=1`], {
        encoding: "utf8",
      }),
    );
    if (latest) {
      const payload =
        typeof latest.payload === "string" ? JSON.parse(latest.payload || "{}") : latest.payload;
      current[slot] = { sha: latest.sha, pr: payload?.pr ? String(payload.pr) : "" };
    }
  }
  return current;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const repo = process.env.GITHUB_REPOSITORY;
  const event = process.env.EVENT;
  const action = process.env.ACTION;
  const needsCurrent = !(event === "pull_request" && action === "labeled");
  const targets = selectTargets({
    event,
    action,
    label: process.env.LABEL,
    pr: process.env.PR,
    headSha: process.env.HEAD_SHA,
    headRepo: process.env.HEAD_REPO,
    repo,
    mainSha: process.env.MAIN_SHA,
    current: needsCurrent ? currentDeployments(repo) : {},
  });
  process.stdout.write(`targets=${JSON.stringify(targets)}\n`);
}
