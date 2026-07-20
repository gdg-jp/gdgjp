import assert from "node:assert/strict";
import test from "node:test";

import { syncOrganizationInvitations } from "./sync-org-invitations.mjs";

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

test("invites only users who are neither members nor pending invitees", async () => {
  const requests = [];
  const fetchImpl = async (url, options) => {
    const { pathname } = new URL(url);
    requests.push({ pathname, options });

    if (options.method === "POST") {
      return jsonResponse({ id: 99 }, 201);
    }
    if (pathname === "/orgs/gdsc-osaka/members") {
      return jsonResponse([
        { id: 1, login: "existing" },
        { id: 2, login: "pending" },
        { id: 3, login: "new-member" },
      ]);
    }
    if (pathname === "/orgs/gdg-jp/members") {
      return jsonResponse([{ id: 1, login: "existing" }]);
    }
    if (pathname === "/orgs/gdg-jp/invitations") {
      return jsonResponse([{ login: "Pending" }]);
    }
    throw new Error(`Unexpected request: ${url}`);
  };

  const result = await syncOrganizationInvitations({
    sourceOrg: "gdsc-osaka",
    targetOrg: "gdg-jp",
    sourceToken: "source-token",
    targetToken: "target-token",
    fetchImpl,
    sleep: async () => {},
    log: () => {},
  });

  assert.deepEqual(result.candidates, ["new-member"]);
  assert.equal(result.invitationsSent, 1);
  const invitation = requests.find(({ options }) => options.method === "POST");
  assert.deepEqual(JSON.parse(invitation.options.body), {
    invitee_id: 3,
    role: "direct_member",
  });
  assert.equal(invitation.options.headers.Authorization, "Bearer target-token");
});

test("dry-run reports candidates without creating invitations", async () => {
  let postCount = 0;
  const fetchImpl = async (url, options) => {
    const { pathname } = new URL(url);
    if (options.method === "POST") {
      postCount += 1;
    }
    if (pathname === "/orgs/gdsc-osaka/members") {
      return jsonResponse([{ id: 7, login: "candidate" }]);
    }
    return jsonResponse([]);
  };

  const result = await syncOrganizationInvitations({
    sourceOrg: "gdsc-osaka",
    targetOrg: "gdg-jp",
    sourceToken: "source-token",
    targetToken: "target-token",
    dryRun: true,
    fetchImpl,
    log: () => {},
  });

  assert.deepEqual(result.candidates, ["candidate"]);
  assert.equal(result.invitationsSent, 0);
  assert.equal(postCount, 0);
});

test("continues inviting remaining candidates after an invitation fails", async () => {
  const attemptedIds = [];
  const fetchImpl = async (url, options) => {
    const { pathname } = new URL(url);
    if (options.method === "POST") {
      const { invitee_id: inviteeId } = JSON.parse(options.body);
      attemptedIds.push(inviteeId);
      return inviteeId === 1
        ? jsonResponse({ message: "Validation failed" }, 422)
        : jsonResponse({ id: 100 }, 201);
    }
    if (pathname === "/orgs/gdsc-osaka/members") {
      return jsonResponse([
        { id: 1, login: "a-failing-member" },
        { id: 2, login: "b-successful-member" },
      ]);
    }
    return jsonResponse([]);
  };

  const result = await syncOrganizationInvitations({
    sourceOrg: "gdsc-osaka",
    targetOrg: "gdg-jp",
    sourceToken: "source-token",
    targetToken: "target-token",
    fetchImpl,
    sleep: async () => {},
    log: () => {},
  });

  assert.deepEqual(attemptedIds, [1, 2]);
  assert.equal(result.invitationsSent, 1);
  assert.deepEqual(
    result.failures.map(({ login }) => login),
    ["a-failing-member"],
  );
});
