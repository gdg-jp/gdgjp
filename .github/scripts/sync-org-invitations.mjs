import { appendFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const API_URL = "https://api.github.com";
const API_VERSION = "2026-03-10";
const PAGE_SIZE = 100;
const INVITATION_DELAY_MS = 1_000;

export class GitHubApiClient {
  constructor({ token, fetchImpl = fetch }) {
    this.token = token;
    this.fetchImpl = fetchImpl;
  }

  async request(path, { method = "GET", body } = {}) {
    const response = await this.fetchImpl(`${API_URL}${path}`, {
      method,
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${this.token}`,
        "X-GitHub-Api-Version": API_VERSION,
        "User-Agent": "gdgjp-org-invitation-sync",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    if (!response.ok) {
      const details = await response.text();
      throw new Error(`GitHub API ${method} ${path} failed with ${response.status}: ${details}`);
    }

    if (response.status === 204) {
      return undefined;
    }

    return response.json();
  }

  async list(path) {
    const items = [];

    for (let page = 1; ; page += 1) {
      const separator = path.includes("?") ? "&" : "?";
      const result = await this.request(`${path}${separator}per_page=${PAGE_SIZE}&page=${page}`);

      if (!Array.isArray(result)) {
        throw new Error(`GitHub API ${path} returned a non-array response`);
      }

      items.push(...result);
      if (result.length < PAGE_SIZE) {
        return items;
      }
    }
  }
}

export async function syncOrganizationInvitations({
  sourceOrg,
  targetOrg,
  sourceToken,
  targetToken,
  dryRun = false,
  reinviteFailed = false,
  fetchImpl = fetch,
  sleep = defaultSleep,
  log = console.log,
}) {
  const sourceClient = new GitHubApiClient({ token: sourceToken, fetchImpl });
  const targetClient = new GitHubApiClient({ token: targetToken, fetchImpl });

  const sourceMembers = await sourceClient.list(`/orgs/${sourceOrg}/members`);
  const targetMembers = await targetClient.list(`/orgs/${targetOrg}/members`);
  const pendingInvitations = await targetClient.list(`/orgs/${targetOrg}/invitations`);
  const failedInvitations = await targetClient.list(`/orgs/${targetOrg}/failed_invitations`);

  const targetMemberIds = new Set(targetMembers.map((member) => member.id));
  const pendingLogins = new Set(
    pendingInvitations
      .map((invitation) => invitation.login?.toLowerCase())
      .filter((login) => login !== undefined),
  );
  const failedLogins = new Set(
    failedInvitations
      .map((invitation) => invitation.login?.toLowerCase())
      .filter((login) => login !== undefined),
  );
  const candidates = sourceMembers
    .filter(
      (member) =>
        !targetMemberIds.has(member.id) &&
        !pendingLogins.has(member.login.toLowerCase()) &&
        (reinviteFailed || !failedLogins.has(member.login.toLowerCase())),
    )
    .sort((a, b) => a.login.localeCompare(b.login));

  log(
    `Found ${sourceMembers.length} ${sourceOrg} members, ${targetMembers.length} ` +
      `${targetOrg} members, ${pendingInvitations.length} pending invitations, and ` +
      `${failedInvitations.length} failed invitations.`,
  );

  if (candidates.length === 0) {
    log("All source organization members are already members or have invitation history.");
  }

  const failures = [];
  let invitationsSent = 0;

  for (const [index, member] of candidates.entries()) {
    if (dryRun) {
      log(`[dry-run] Would invite @${member.login}.`);
      continue;
    }

    try {
      await targetClient.request(`/orgs/${targetOrg}/invitations`, {
        method: "POST",
        body: { invitee_id: member.id, role: "direct_member" },
      });
      invitationsSent += 1;
      log(`Invited @${member.login}.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push({ login: member.login, message });
      log(`Failed to invite @${member.login}: ${message}`);
    }

    // GitHub recommends serial requests for content-creating endpoints to avoid secondary limits.
    if (index < candidates.length - 1) {
      await sleep(INVITATION_DELAY_MS);
    }
  }

  return {
    sourceMembers: sourceMembers.length,
    targetMembers: targetMembers.length,
    pendingInvitations: pendingInvitations.length,
    failedInvitations: failedInvitations.length,
    candidates: candidates.map((member) => member.login),
    invitationsSent,
    failures,
    dryRun,
    reinviteFailed,
  };
}

async function defaultSleep(milliseconds) {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function requireEnvironment(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Required environment variable ${name} is not set`);
  }
  return value;
}

async function writeSummary(result, sourceOrg, targetOrg) {
  if (!process.env.GITHUB_STEP_SUMMARY) {
    return;
  }

  const mode = result.dryRun ? "Dry run" : "Invitations sent";
  const candidates =
    result.candidates.length > 0
      ? result.candidates.map((login) => `@${login}`).join(", ")
      : "None";
  const summary = [
    "## Organization invitation sync",
    "",
    `- Source: \`${sourceOrg}\` (${result.sourceMembers} members)`,
    `- Target: \`${targetOrg}\` (${result.targetMembers} members)`,
    `- Pending invitations: ${result.pendingInvitations}`,
    `- Failed or expired invitations: ${result.failedInvitations}`,
    `- Re-invite failed users: ${result.reinviteFailed ? "Yes" : "No"}`,
    `- ${mode}: ${result.dryRun ? result.candidates.length : result.invitationsSent}`,
    `- Invitation attempts failed: ${result.failures.length}`,
    `- Candidates: ${candidates}`,
    "",
  ].join("\n");

  await appendFile(process.env.GITHUB_STEP_SUMMARY, summary);
}

export async function main() {
  const sourceOrg = requireEnvironment("SOURCE_ORG");
  const targetOrg = requireEnvironment("TARGET_ORG");
  const result = await syncOrganizationInvitations({
    sourceOrg,
    targetOrg,
    sourceToken: requireEnvironment("SOURCE_ORG_TOKEN"),
    targetToken: requireEnvironment("TARGET_ORG_TOKEN"),
    dryRun: process.env.DRY_RUN === "true",
    reinviteFailed: process.env.REINVITE_FAILED === "true",
  });
  await writeSummary(result, sourceOrg, targetOrg);

  if (result.failures.length > 0) {
    throw new Error(`${result.failures.length} organization invitation(s) failed`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
