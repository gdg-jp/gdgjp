#!/usr/bin/env node
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { verifyAlloySkill } from "../../../../scripts/verification/alloy-skill.mjs";

const mutations = [
  {
    id: "trigger-leaves-clients-enabled",
    kills: "EnabledClientHasMemberOwnerWhenSerial",
    code: "migration 0014: drop UPDATE oauthClient SET disabled = 1 from the membership triggers",
    find: "    Db.disabled' = Db.disabled + ownedBy[u]\n    Db.live' = Db.live - client.(ownedBy[u])",
    replace: "    Db.disabled' = Db.disabled\n    Db.live' = Db.live - client.(ownedBy[u])",
  },
  {
    id: "trigger-leaves-tokens",
    kills: "RevokedTokenStaysDeadWhenSerial",
    code: "migration 0014: drop the DELETEs on oauthAccessToken and oauthRefreshToken from the membership triggers",
    find: "    Db.disabled' = Db.disabled + ownedBy[u]\n    Db.live' = Db.live - client.(ownedBy[u])",
    replace: "    Db.disabled' = Db.disabled + ownedBy[u]\n    Db.live' = Db.live",
  },
  {
    id: "membership-loss-leaves-grant-records",
    kills: "RevokedTokenStaysDead",
    code: "migration 0026: drop the developerClientGrantCode DELETE from the oauthClient trigger that the membership triggers fire",
    find: "    Db.grants' = Db.grants - client.(ownedBy[u])\n",
    replace: "    Db.grants' = Db.grants\n",
  },
  {
    id: "disable-leaves-grant-records",
    kills: "RevokedTokenStaysDead",
    code: "migration 0026: drop the developerClientGrantCode DELETE from the oauthClient trigger that setDeveloperClientEnabled(false) fires",
    find: "  Db.grants' = Db.grants - client.(r.subject)\n  Db.issuing' = Db.issuing\n  Ghost.preRevocation'",
    replace: "  Db.grants' = Db.grants\n  Db.issuing' = Db.issuing\n  Ghost.preRevocation'",
  },
  {
    id: "create-without-membership",
    kills: "EnabledClientHasMemberOwner",
    code: "oauth-clients.server.ts createDeveloperClient: drop WHERE EXISTS (active membership) from the INSERT",
    find: "  isMember[r.by]\n  Db.clients' = Db.clients + c\n",
    replace: "  Db.clients' = Db.clients + c\n",
  },
  {
    id: "enable-without-membership",
    kills: "EnabledClientHasMemberOwner",
    code: "oauth-clients.server.ts setDeveloperClientEnabled: drop the active-membership EXISTS from the UPDATE",
    find: "  isMember[r.by]\n  Db.disabled' = Db.disabled - (r.subject & Db.clients)\n",
    replace: "  Db.disabled' = Db.disabled - (r.subject & Db.clients)\n",
  },
];

const label = (atom) => atom?.replace(/0$/, "") ?? null;
const OPERATION = {
  Create: "create a client",
  Enable: "enable",
  Disable: "disable",
  Update: "update",
  Delete: "delete",
};

function view(state) {
  const db = state.Db0;
  const ghost = state.Ghost0;
  const users = Object.keys(state).filter((atom) => /^User\d+$/.test(atom));
  const has = (field, atom) => db[field].some(([x]) => x === atom);
  const actives = (user) =>
    db.membership.filter(([u, , status]) => u === user && status === "Active0").map(([, c]) => c);
  const enabled = (client) => has("clients", client) && !has("disabled", client);
  const ownerOf = (client) => state[client].owner[0][0];
  const clientOf = (token) => state[token].client[0][0];
  return {
    users,
    actives,
    enabled,
    ownerOf,
    clientOf,
    clients: db.clients.map(([c]) => c),
    live: db.live.map(([t]) => t),
    preRevocation: ghost.preRevocation.map(([t]) => t),
    event: label(ghost.event[0][0]),
    user: ghost.evUser[0]?.[0] ?? null,
    client: ghost.evClient[0]?.[0] ?? null,
    token: ghost.evToken[0]?.[0] ?? null,
    operation: (request) => OPERATION[label(state[request].op[0]?.[0])],
    requests: Object.keys(state).filter((atom) => /^Req\d+$/.test(atom)),
    pc: (request) => label(state[request].pc[0][0]),
    by: (request) => state[request].by[0]?.[0] ?? null,
  };
}

const enabledWithoutMember = (s) => {
  const bad = s.clients.find((c) => s.enabled(c) && s.actives(s.ownerOf(c)).length === 0);
  return bad
    ? `${bad} is enabled, but its owner ${s.ownerOf(bad)} has no active membership.`
    : null;
};
const revivedToken = (s) => {
  const bad = s.preRevocation.find((t) => s.live.includes(t) && s.enabled(s.clientOf(t)));
  return bad
    ? `${bad} was issued before ${s.clientOf(bad)} was revoked, and it works again through it.`
    : null;
};
const violations = {
  EnabledClientHasMemberOwner: enabledWithoutMember,
  EnabledClientHasMemberOwnerWhenSerial: enabledWithoutMember,
  RevokedTokenStaysDead: revivedToken,
  RevokedTokenStaysDeadWhenSerial: revivedToken,
};

function narrate(states, name) {
  const start = view(states[0]);
  const lines = ["  Setting:"];
  for (const user of start.users) {
    lines.push(`    ${user}: active member of ${start.actives(user).join(", ") || "no chapter"}`);
  }
  const check = violations[name];
  let step = 0;
  for (let index = 1; index < states.length; index++) {
    const before = view(states[index - 1]);
    const s = view(states[index]);
    const request = s.requests.find(
      (r) => before.pc(r) !== s.pc(r) || (before.pc(r) !== "Idle" && before.by(r) === s.user),
    );
    const operation = request ? (s.operation(request) ?? before.operation(request)) : "the request";
    const memberships = s.user
      ? `${s.user} is now an active member of ${s.actives(s.user).join(", ") || "no chapter"}`
      : "";
    const revoked =
      s.user && before.actives(s.user).length > 0 && s.actives(s.user).length === 0
        ? " The triggers disable their clients and delete those clients' tokens and grant records."
        : "";
    const sentences = {
      MembershipChange: `A membership statement runs: ${memberships}.${revoked}`,
      Admit: `${s.user} asks to ${operation}${s.client ? ` ${s.client}` : ""}. requireDeveloperAccess lets the request in.`,
      Find: `The request finds ${s.client} owned by ${s.user}.`,
      Create: `The request inserts ${s.client}, enabled, owned by ${s.user}, who is still a member.`,
      Enable: `The request writes disabled = 0 on ${s.client}; its owner is still a member.`,
      Disable: `The request writes disabled = 1 on ${s.client}; the trigger deletes its tokens and grant records.`,
      Update: `The request updates ${s.client}.`,
      Delete: `The request deletes ${s.client}; its tokens go with it.`,
      IssueBegin: `Someone signs in through ${s.client}. The token endpoint finds the client enabled.`,
      IssueFinish: `The token endpoint inserts ${s.token} for ${s.client}.`,
      IssueRejected: `The token insert for ${s.client} fails: the client row or the grant record is gone.`,
      Abort: `${s.user}'s request stops without another write.`,
    };
    const sentence = sentences[s.event.slice(1)];
    if (sentence) lines.push(`  ${++step}. ${sentence}`);
    const reason = check?.(s);
    if (reason) {
      lines.push(`  => ${reason}`);
      return lines;
    }
  }
  return lines;
}

await verifyAlloySkill({
  skill: dirname(dirname(fileURLToPath(import.meta.url))),
  id: "accounts-client-revocation",
  model: "model/clients.als",
  mutations,
  narrate,
});
