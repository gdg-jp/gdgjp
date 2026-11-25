module clients

-- accounts.gdgs.jp: developer-owned OAuth clients, their owners' chapter memberships, and
-- the tokens issued through those clients. Each transition below is one D1 statement or
-- one D1 batch, with the triggers of migrations 0014, 0025 and 0026 inside the statement
-- that fires them. coverage.json maps every transition to the code it describes.

sig Chapter {}
sig User {}
sig Client { owner: one User }
sig Token { client: one Client }

abstract sig MemberStatus {}
one sig Pending, Active extends MemberStatus {}

one sig Db {
  var membership: User -> Chapter -> lone MemberStatus,
  var clients: set Client,
  var disabled: set Client,
  var live: set Token,
  var issuing: set Token,
  -- developerClientGrantCode: the record of the authorization code behind a token
  var grants: set Token
}

abstract sig Pc {}
one sig Idle, Admitted, Found extends Pc {}

abstract sig Op {}
one sig Create, Enable, Disable, Update, Delete extends Op {}

sig Req {
  var pc: one Pc,
  var op: lone Op,
  var by: lone User,
  var subject: lone Client
}

abstract sig Event {}
one sig EInit, EMembershipChange, EAdmit, EFind, ECreate, EEnable, EDisable, EUpdate, EDelete,
  EIssueBegin, EIssueFinish, EIssueRejected, EAbort, EStutter
  extends Event {}

-- History the product does not store. No transition reads it, except that a token is
-- issued once.
one sig Ghost {
  var used: set Token,
  var everClient: set Client,
  var revoked: set Client,
  var preRevocation: set Token,
  var event: one Event,
  var evUser: lone User,
  var evClient: lone Client,
  var evToken: lone Token
}

fun actives[u: User]: set Chapter { Db.membership[u].Active }
pred isMember[u: User] { some actives[u] }
fun ownedBy[u: User]: set Client { Db.clients & owner.u }
pred enabled[c: Client] { c in Db.clients - Db.disabled }
-- Better Auth: a token works only while its row exists and its client is enabled.
pred usable[t: Token] { t in Db.live and enabled[t.client] }

pred sameMemberships { Db.membership' = Db.membership }
pred sameClients { Db.clients' = Db.clients and Db.disabled' = Db.disabled }
pred sameTokens { Db.live' = Db.live and Db.issuing' = Db.issuing and Db.grants' = Db.grants }
pred sameReqsExcept[r: lone Req] {
  all q: Req - r | q.pc' = q.pc and q.op' = q.op and q.by' = q.by and q.subject' = q.subject
}
pred advance[r: Req, to: Pc] {
  r.pc' = to
  r.op' = r.op
  r.by' = r.by
  r.subject' = r.subject
}
pred finish[r: Req] {
  r.pc' = Idle
  no r.op'
  no r.by'
  no r.subject'
}
pred sameHistory {
  Ghost.used' = Ghost.used
  Ghost.everClient' = Ghost.everClient
  Ghost.revoked' = Ghost.revoked
  Ghost.preRevocation' = Ghost.preRevocation
}
pred log[e: Event, u: lone User, c: lone Client, t: lone Token] {
  Ghost.event' = e
  Ghost.evUser' = u
  Ghost.evClient' = c
  Ghost.evToken' = t
}

fact init {
  no Db.membership.Pending
  no Db.clients
  no Db.disabled
  no Db.live
  no Db.issuing
  no Db.grants
  all r: Req | r.pc = Idle and no r.op and no r.by and no r.subject
  no Ghost.used
  no Ghost.everClient
  no Ghost.revoked
  no Ghost.preRevocation
  Ghost.event = EInit
  no Ghost.evUser
  no Ghost.evClient
  no Ghost.evToken
}

-- Any statement or batch that writes memberships rows of one user: join, approve, revert,
-- remove, leave, the admin's chapter list, a chapter delete. Migration 0014's triggers run
-- inside it: when the user had an active membership and has none afterwards, every client
-- the user owns is disabled and its tokens are deleted. Writing disabled = 1 fires migration
-- 0026's trigger on oauthClient, which also deletes the clients' grant-code records.
pred membershipChange[u: User] {
  Db.membership' != Db.membership
  all v: User - u | Db.membership'[v] = Db.membership[v]
  (isMember[u] and no Db.membership'[u].Active) implies {
    Db.disabled' = Db.disabled + ownedBy[u]
    Db.live' = Db.live - client.(ownedBy[u])
    Db.grants' = Db.grants - client.(ownedBy[u])
    Ghost.revoked' = Ghost.revoked + ownedBy[u]
    Ghost.preRevocation' = Ghost.preRevocation + (Db.live + Db.issuing) & client.(ownedBy[u])
  } else {
    Db.disabled' = Db.disabled
    Db.live' = Db.live
    Db.grants' = Db.grants
    Ghost.revoked' = Ghost.revoked
    Ghost.preRevocation' = Ghost.preRevocation
  }
  Db.clients' = Db.clients
  Db.issuing' = Db.issuing
  Ghost.used' = Ghost.used
  Ghost.everClient' = Ghost.everClient
  sameReqsExcept[none]
  log[EMembershipChange, u, none, none]
}

-- developer-apps/oauth-clients.server.ts requireDeveloperAccess: one SELECT on memberships
pred admit[r: Req, u: User, o: Op, c: lone Client] {
  r.pc = Idle
  isMember[u]
  o = Create implies no c else one c
  r.pc' = Admitted
  r.op' = o
  r.by' = u
  r.subject' = c
  sameMemberships and sameClients and sameTokens and sameReqsExcept[r] and sameHistory
  log[EAdmit, u, c, none]
}

-- requireOwnedClient: one SELECT on oauthClient by clientId and userId
pred find[r: Req] {
  r.pc = Admitted
  r.op in Enable + Disable + Update + Delete
  r.subject in ownedBy[r.by]
  advance[r, Found]
  sameMemberships and sameClients and sameTokens and sameReqsExcept[r] and sameHistory
  log[EFind, r.by, r.subject, none]
}

-- createDeveloperClient: INSERT INTO oauthClient ... SELECT with disabled = 0, WHERE the
-- owner has an active membership. When the owner has none, the statement inserts nothing
-- and the request ends with 403 (abort).
pred create[r: Req, c: Client] {
  r.pc = Admitted
  r.op = Create
  c not in Ghost.everClient
  c.owner = r.by
  isMember[r.by]
  Db.clients' = Db.clients + c
  Db.disabled' = Db.disabled
  Ghost.everClient' = Ghost.everClient + c
  Ghost.used' = Ghost.used
  Ghost.revoked' = Ghost.revoked
  Ghost.preRevocation' = Ghost.preRevocation
  finish[r]
  sameMemberships and sameTokens and sameReqsExcept[r]
  log[ECreate, r.by, c, none]
}

-- setDeveloperClientEnabled(true): UPDATE oauthClient SET disabled = 0 WHERE clientId, userId
-- and the owner has an active membership. When the owner has none, the statement changes
-- nothing and the request ends with 403 (abort).
pred enable[r: Req] {
  r.pc = Found
  r.op = Enable
  isMember[r.by]
  Db.disabled' = Db.disabled - (r.subject & Db.clients)
  Db.clients' = Db.clients
  finish[r]
  sameMemberships and sameTokens and sameReqsExcept[r] and sameHistory
  log[EEnable, r.by, r.subject, none]
}

-- setDeveloperClientEnabled(false): the same UPDATE with disabled = 1. Migration 0026's
-- trigger on oauthClient deletes the client's tokens and grant-code records in it.
pred disable[r: Req] {
  r.pc = Found
  r.op = Disable
  Db.disabled' = Db.disabled + (r.subject & Db.clients)
  Db.clients' = Db.clients
  Db.live' = Db.live - client.(r.subject)
  Db.grants' = Db.grants - client.(r.subject)
  Db.issuing' = Db.issuing
  Ghost.preRevocation' = Ghost.preRevocation + (Db.live + Db.issuing) & client.(r.subject & Db.clients)
  Ghost.used' = Ghost.used
  Ghost.everClient' = Ghost.everClient
  Ghost.revoked' = Ghost.revoked
  finish[r]
  sameMemberships and sameReqsExcept[r]
  log[EDisable, r.by, r.subject, none]
}

-- updateDeveloperClient: UPDATE of name, URIs and scopes. When the scopes change, migration
-- 0026's trigger deletes the client's tokens and grant-code records in it.
pred update[r: Req] {
  r.pc = Found
  r.op = Update
  (Db.live' = Db.live and Db.grants' = Db.grants)
    or (Db.live' = Db.live - client.(r.subject) and Db.grants' = Db.grants - client.(r.subject))
  Db.issuing' = Db.issuing
  finish[r]
  sameMemberships and sameClients and sameReqsExcept[r] and sameHistory
  log[EUpdate, r.by, r.subject, none]
}

-- deleteDeveloperClient: DELETE FROM oauthClient; token and grant-code rows cascade
pred delete[r: Req] {
  r.pc = Found
  r.op = Delete
  Db.clients' = Db.clients - r.subject
  Db.disabled' = Db.disabled - r.subject
  Db.live' = Db.live - client.(r.subject)
  Db.grants' = Db.grants - client.(r.subject)
  Db.issuing' = Db.issuing
  finish[r]
  sameMemberships and sameReqsExcept[r] and sameHistory
  log[EDelete, r.by, r.subject, none]
}

-- Better Auth token endpoint: validateClientCredentials rejects a disabled client, then the
-- code or refresh token is read. Its grant-code record was written when the code was issued
-- (migration 0026 records a code only while its client is enabled). Granting the record
-- here, at the read, allows at least every record the code can have.
pred issueBegin[t: Token] {
  t not in Ghost.used
  enabled[t.client]
  Db.issuing' = Db.issuing + t
  Db.grants' = Db.grants + t
  Db.live' = Db.live
  Ghost.used' = Ghost.used + t
  Ghost.everClient' = Ghost.everClient
  Ghost.revoked' = Ghost.revoked
  Ghost.preRevocation' = Ghost.preRevocation
  sameMemberships and sameClients and sameReqsExcept[none]
  log[EIssueBegin, none, t.client, t]
}

-- Better Auth token endpoint: INSERT of the token rows, a later statement. Migration 0025's
-- BEFORE INSERT triggers abort it unless the grant-code record still exists.
pred issueFinish[t: Token] {
  t in Db.issuing
  t.client in Db.clients
  t in Db.grants
  Db.issuing' = Db.issuing - t
  Db.live' = Db.live + t
  Db.grants' = Db.grants
  sameMemberships and sameClients and sameReqsExcept[none] and sameHistory
  log[EIssueFinish, none, t.client, t]
}

-- The INSERT fails on the clientId foreign key when the client row is gone, or on the
-- grant-code triggers when the record was deleted
pred issueRejected[t: Token] {
  t in Db.issuing
  t.client not in Db.clients or t not in Db.grants
  Db.issuing' = Db.issuing - t
  Db.live' = Db.live
  Db.grants' = Db.grants
  sameMemberships and sameClients and sameReqsExcept[none] and sameHistory
  log[EIssueRejected, none, t.client, t]
}

-- A request that returns an error, or a Worker that stops, at any await
pred abort[r: Req] {
  r.pc != Idle
  log[EAbort, r.by, r.subject, none]
  finish[r]
  sameMemberships and sameClients and sameTokens and sameReqsExcept[r] and sameHistory
}

pred stutter {
  sameMemberships and sameClients and sameTokens and sameReqsExcept[none] and sameHistory
  log[EStutter, none, none, none]
}

fact transitions {
  always {
    stutter
    or (some u: User | membershipChange[u])
    or (some t: Token | issueBegin[t] or issueFinish[t] or issueRejected[t])
    or (some r: Req, u: User, o: Op, c: Client | admit[r, u, o, c])
    or (some r: Req, u: User, o: Op | admit[r, u, o, none])
    or (some r: Req, c: Client | create[r, c])
    or (some r: Req {
      find[r] or enable[r] or disable[r] or update[r] or delete[r] or abort[r]
    })
  }
}

pred quiet { (all r: Req | r.pc = Idle) and no Db.issuing }

-- Requests and token issuance do not overlap anything else: once one begins, only its own
-- steps happen until it ends.
pred serial {
  always (not quiet implies after Ghost.event in
    EFind + ECreate + EEnable + EDisable + EUpdate + EDelete + EIssueFinish + EIssueRejected
    + EAbort)
}

-- Developer-console requests do not overlap anything. A sign-in through a client may
-- still be in flight while other statements run.
pred consoleSerial {
  always ((some r: Req | r.pc != Idle) implies after Ghost.event in
    EFind + ECreate + EEnable + EDisable + EUpdate + EDelete + EAbort)
}

-- An enabled developer client belongs to someone with an active membership.
assert EnabledClientHasMemberOwner {
  always (all c: Db.clients - Db.disabled | isMember[c.owner])
}

assert EnabledClientHasMemberOwnerWhenSerial {
  serial implies always (all c: Db.clients - Db.disabled | isMember[c.owner])
}

-- A token issued before its client was revoked, because its owner lost membership or
-- disabled it, never works again.
assert RevokedTokenStaysDead {
  consoleSerial implies always (no t: Ghost.preRevocation | usable[t])
}

assert RevokedTokenStaysDeadWhenSerial {
  serial implies always (no t: Ghost.preRevocation | usable[t])
}

-- Witnesses: the checks above must not hold only because nothing can happen.
pred TokenWorks { eventually (some t: Token | usable[t]) }
pred MembershipLossRevokes { eventually (some Ghost.revoked and some Ghost.preRevocation) }
pred OwnerReenablesAfterReturning {
  serial and eventually (some c: Ghost.revoked | enabled[c] and isMember[c.owner])
}
pred NewGrantWorksAfterReturning {
  serial and eventually (some t: Token - Ghost.preRevocation | usable[t] and t.client in Ghost.revoked)
}

check EnabledClientHasMemberOwner
  for 3 but exactly 2 Chapter, exactly 2 User, exactly 2 Client, exactly 3 Token, exactly 2 Req, 14 steps
check EnabledClientHasMemberOwnerWhenSerial
  for 3 but exactly 2 Chapter, exactly 2 User, exactly 2 Client, exactly 3 Token, exactly 2 Req, 14 steps
check RevokedTokenStaysDead
  for 3 but exactly 2 Chapter, exactly 2 User, exactly 2 Client, exactly 3 Token, exactly 2 Req, 14 steps
check RevokedTokenStaysDeadWhenSerial
  for 3 but exactly 2 Chapter, exactly 2 User, exactly 2 Client, exactly 3 Token, exactly 2 Req, 14 steps
run TokenWorks
  for 3 but exactly 2 Chapter, exactly 2 User, exactly 2 Client, exactly 3 Token, exactly 2 Req, 14 steps
run MembershipLossRevokes
  for 3 but exactly 2 Chapter, exactly 2 User, exactly 2 Client, exactly 3 Token, exactly 2 Req, 14 steps
run OwnerReenablesAfterReturning
  for 3 but exactly 2 Chapter, exactly 2 User, exactly 2 Client, exactly 3 Token, exactly 2 Req, 14 steps
run NewGrantWorksAfterReturning
  for 3 but exactly 2 Chapter, exactly 2 User, exactly 2 Client, exactly 3 Token, exactly 2 Req, 14 steps
