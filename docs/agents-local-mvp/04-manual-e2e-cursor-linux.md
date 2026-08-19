# Stage 04 manual E2E — interactive Cursor agent runbook for Linux

This runbook verifies [Stage 04](04-xangi-authz-iam.md) on the Linux server with
`cursor-agent` as the xangi backend. It also migrates the server checkout from its current
upstream to [`harineko0/xangi`](https://github.com/harineko0/xangi) in a reversible way.

The test is intentionally interactive. Cursor must stop at every checkpoint, show evidence,
and wait for the operator. Do not run the whole document unattended.

Start Cursor with this instruction:

```text
Follow docs/agents-local-mvp/04-manual-e2e-cursor-linux.md interactively.
Execute Checkpoint 0 only, show the required checkpoint response, and wait for my answer.
Do not skip checkpoints or perform a mutation before its explicit approval.
```

## Interaction contract

When following this file, Cursor must use this response shape at every checkpoint:

```text
Checkpoint: <number and name>
Evidence:
- <command/result, with secrets redacted>
Result: PASS | FAIL | BLOCKED
Next action: <exact action that would be taken>
Question: Continue? (yes/no)
```

Rules:

- Run observation commands first. Ask before `sudo`, service restarts, remote changes, package
  installation, or file writes.
- When the active repository instructions require `rtk`, prefix every external command with
  `rtk`; use the shell or tool working-directory option instead of wrapping the `cd` builtin.
- Execute only one checkpoint after each operator confirmation.
- Never print Discord tokens, OAuth tokens, refresh tokens, device codes, `.env` contents, or the
  full authorization nonce. Show only whether they exist and, for a nonce, at most the first eight
  characters.
- Never use `git reset --hard`, `git clean`, forced checkout, forced push, or deletion as a shortcut.
- If the server checkout is dirty, stop. Do not stash, discard, or commit server-local changes
  without separate operator instructions.
- If an expected denial unexpectedly starts an agent child, stop the test and report a security
  failure.
- Record actual IDs and paths locally in the test notes, but redact them from chat when requested.
- Stage 07 is not complete. Use test guilds only; do not connect this deployment to a production
  guild.

## Values Cursor must ask for

At Checkpoint 0, ask the operator for these values and do not infer missing values:

```text
XANGI_CHECKOUT=<absolute path to the server checkout>
XANGI_SERVICE=<systemd unit, PM2 app, or other restart target>
SERVICE_MANAGER=systemd|pm2|other
SERVICE_USER=gdgagent-svc
SLOT=0
FORK_URL=https://github.com/harineko0/xangi.git
APPROVED_REV=<commit SHA or signed/tagged revision approved for this test>
CURSOR_COMMAND=<cursor-agent executable or configured backend command>
TEST_GUILD_A=<Discord test guild for chapter A>
TEST_GUILD_B=<Discord test guild for chapter B>
CHAPTER_A=<Accounts chapter ID>
CHAPTER_B=<Accounts chapter ID>
ORGANIZER_USER=<logged-in Accounts organizer>
ROLE_ONLY_USER=<not logged in; receives a mapped Discord role>
UNLINKED_USER=<not logged in and initially has no mapped role>
```

Do not accept `main` alone as `APPROVED_REV`. The test must be reproducible against an immutable
revision. The revision must contain the Stage 04 implementation and its reviewed fixes.

## Checkpoint 0 — confirm scope and operator access

Cursor asks for the values above and confirms that the operator can:

- administer the two test Discord guilds;
- authenticate the organizer through the GDG Accounts device flow;
- run read-only commands as `SERVICE_USER`;
- approve isolated `sudo` commands for socket-directory preparation and service control;
- inspect an agent child's `/proc/<pid>/environ` without exposing it in chat.

**Stop condition:** any guild is a production guild, the revision is not immutable, or the operator
cannot inspect the service and child processes.

## Checkpoint 1 — capture the current deployment without changing it

Cursor runs:

```bash
cd "$XANGI_CHECKOUT"
pwd
git status --short --branch
git remote -v
git branch --show-current
git rev-parse HEAD
git log -1 --oneline
```

Cursor also inspects, without printing secret values:

```bash
test -f .env && echo '.env: present' || echo '.env: absent'
test -f package-lock.json && echo 'package-lock.json: present'
```

Record:

```text
PREVIOUS_ORIGIN=<git remote get-url origin>
PREVIOUS_BRANCH=<current branch>
PREVIOUS_REV=<current HEAD>
```

**Pass:** the checkout path is correct and the worktree is clean.

**Stop condition:** any tracked modification, staged change, deletion, conflict, or unexpected
untracked deployment file is present. Ask the operator how to preserve it.

## Checkpoint 2 — inspect `harineko0/xangi` before switching

Fetching is read-only, but Cursor still shows the proposed command and asks before network access.
After approval:

```bash
cd "$XANGI_CHECKOUT"
git ls-remote "$FORK_URL" HEAD refs/heads/main
git fetch "$FORK_URL" "$APPROVED_REV"
git cat-file -e "$APPROVED_REV^{commit}"
git show --no-patch --format='%H%n%an%n%ad%n%s' "$APPROVED_REV"
```

Cursor verifies that the approved revision includes the required fixes. At minimum, inspect the
history for the equivalents of:

- Discord authorization at the execution boundary;
- atomic account linking and refresh;
- serialized authorization-socket replacement;
- one-shot Cursor/CLI authz environment propagation;
- strict IAM schema validation.

Useful commands:

```bash
git log --oneline --decorate --max-count=30 "$APPROVED_REV"
git show --stat --oneline "$APPROVED_REV"
```

**Stop condition:** `APPROVED_REV` is absent from the fork or does not contain the reviewed Stage 04
changes.

## Checkpoint 3 — switch the checkout to `harineko0/xangi`

This checkpoint changes Git configuration and the checked-out revision. Cursor must show the exact
remote plan and wait for approval.

Use this model:

1. Preserve the old origin as `upstream`.
2. Make `origin` point to `harineko0/xangi`.
3. Create a new local deployment branch instead of overwriting the old branch.
4. Check out the exact approved revision on that branch.

Cursor must adapt safely if `upstream` already exists. A typical clean-checkout sequence is:

```bash
cd "$XANGI_CHECKOUT"
git remote rename origin upstream
git remote add origin "$FORK_URL"
git fetch origin
git switch --create stage04-manual-e2e "$APPROVED_REV"
```

If `origin` already equals `FORK_URL`, do not rename it. If `upstream` exists, verify that it equals
`PREVIOUS_ORIGIN`; do not overwrite it.

Verify:

```bash
git status --short --branch
git remote -v
git rev-parse HEAD
test "$(git rev-parse HEAD)" = "$APPROVED_REV"
```

**Pass:** `origin` is the fork, `upstream` preserves the original URL, the new branch is active,
and `HEAD` exactly matches `APPROVED_REV`.

## Checkpoint 4 — install and verify the selected revision

Cursor first checks runtime versions:

```bash
node --version
npm --version
```

After approval to modify dependencies/build output:

```bash
cd "$XANGI_CHECKOUT"
npm ci
npm run typecheck
npm run lint
npx vitest run \
  tests/account-link.test.ts \
  tests/iam.test.ts \
  tests/authz-server.test.ts \
  tests/cli-process.test.ts \
  tests/runner-authz-env.test.ts \
  tests/discord-authz-boundary.test.ts \
  tests/discord-thread-context.test.ts
npm run build
```

**Pass:** all commands succeed. Do not proceed with a test deployment after a focused-test,
typecheck, lint, or build failure.

## Checkpoint 5 — verify Cursor is the configured one-shot backend

Cursor inspects configuration without printing secrets. The effective configuration must select the
Cursor backend and must not rely on a persistent child process.

Confirm:

- backend is `cursor`;
- the executable resolves to `CURSOR_COMMAND`;
- the service account can execute `cursor-agent --version`;
- Discord execution is forced through a one-shot runner even if a legacy persistent setting is
  present;
- `XANGI_AUTHZ_NONCE` and `XANGI_AUTHZ_SOCKET` are not ambient service variables.

Example read-only checks:

```bash
sudo -u "$SERVICE_USER" sh -lc 'command -v cursor-agent'
sudo -u "$SERVICE_USER" cursor-agent --version
grep -n 'XANGI_AUTHZ' src/safe-env.ts || true
```

Do not print `.env`. Inspect individual variable names with a redacting script or ask the operator
to confirm them.

**Pass:** Cursor is available, authz variables are absent from the ambient allowlist, and the
Discord factory test proves one-shot construction.

## Checkpoint 6 — prepare the per-slot authorization socket

Expected values for slot `SLOT`:

```text
directory: /run/gdg-agent/<SLOT>
socket:    /run/gdg-agent/<SLOT>/authz.sock
group:     gdgagent-run-<SLOT>
owner:     SERVICE_USER
directory mode: 0710
socket mode after startup: 0660
```

Cursor first observes:

```bash
getent passwd "$SERVICE_USER"
getent group "gdgagent-run-$SLOT"
stat -c '%U %G %a %F %n' "/run/gdg-agent/$SLOT" 2>/dev/null || true
```

If creation or repair is necessary, Cursor proposes the exact `sudo install -d` command and waits:

```bash
sudo install -d \
  -o "$SERVICE_USER" \
  -g "gdgagent-run-$SLOT" \
  -m 0710 \
  "/run/gdg-agent/$SLOT"
```

Verify that the slot's agent uid belongs to `gdgagent-run-<SLOT>` when Stage 07 accounts already
exist. Do not create or change agent users as part of this Stage 04 test.

## Checkpoint 7 — review service configuration and restart

The effective service configuration must include:

```text
DISCORD_ALLOWED_USER=*
XANGI_AGENT_SLOT=<SLOT>
XANGI_AUTHZ_SOCKET_DIR=/run/gdg-agent/<SLOT>
XANGI_AUTHZ_SOCKET_GROUP=gdgagent-run-<SLOT>
```

`DISCORD_ALLOWED_USER=*` is acceptable only for these isolated test guilds. Cursor must confirm the
bot is not connected to a production guild before using it.

Cursor asks the operator to confirm that the Discord token and Accounts endpoints are configured,
without displaying their values. It then proposes the service-manager-specific restart command.
Examples:

```bash
sudo systemctl restart "$XANGI_SERVICE"
sudo systemctl status "$XANGI_SERVICE" --no-pager
```

or:

```bash
pm2 restart "$XANGI_SERVICE" --update-env
pm2 describe "$XANGI_SERVICE"
```

After approval and restart, inspect logs with secret redaction and verify:

```bash
stat -c '%U %G %a %F %n' "/run/gdg-agent/$SLOT/authz.sock"
```

Expected socket owner/group/mode: `SERVICE_USER`, `gdgagent-run-<SLOT>`, `660`.

**Stop condition:** startup failure, wrong socket ownership/mode, unexpected TCP listener, or a bot
connection to a production guild.

## Checkpoint 8 — create the Discord test matrix

The operator creates or confirms these resources in Guild A:

- roles: `Chapter A Organizer`, `Chapter A Member`;
- channels: `#unconfigured`, `#chapter-organizers`, `#chapter-members`, `#national-members`,
  `#private`.

Guild B represents `CHAPTER_B` and should have at least one chapter-mapped channel.

Cursor asks the operator to confirm the three user states:

- `ORGANIZER_USER`: Accounts organizer, initially no IAM mapping required;
- `ROLE_ONLY_USER`: not logged in, has `Chapter A Organizer` Discord role;
- `UNLINKED_USER`: not logged in, initially no mapped role.

Do not paste Discord IDs into a public channel. Record them in private test notes if necessary.

## Checkpoint 9 — unbound guild and open login commands

The operator performs one action at a time and reports the observed ephemeral response.

1. `UNLINKED_USER` mentions the bot in Guild A before binding.
   - Expected: no Cursor child starts; reply says the guild is unbound and recommends `/iam bind`.
2. `UNLINKED_USER` runs `/whoami`.
   - Expected: five views are shown; no effective class or channel audience is granted.
3. `ORGANIZER_USER` runs `/login` and completes the device flow.
   - Expected: ephemeral device flow succeeds even if the user would fail the legacy allowlist.
4. `ORGANIZER_USER` runs `/whoami`.
   - Expected: login-derived organizer class is visible; guild remains unbound.

Cursor checks the process list during step 1. Any `cursor-agent` child is a failure.

## Checkpoint 10 — reject role-only IAM administration

Give `ROLE_ONLY_USER` the Discord organizer role, but do not log that user in. Run:

```text
/iam bind chapter:<CHAPTER_A>
```

Expected: `/iam` is rejected because administrator authority must come from the linked Accounts
organizer class, not from Discord role mappings.

## Checkpoint 11 — bind Guild A and configure policy

As `ORGANIZER_USER`, perform:

```text
/iam bind chapter:<CHAPTER_A>
/iam role role:@Chapter A Organizer chapter:<CHAPTER_A> permission:organizer
/iam role role:@Chapter A Member chapter:<CHAPTER_A> permission:member
/iam channel channel:#chapter-organizers visibility:chapter-organizer chapter:<CHAPTER_A>
/iam channel channel:#chapter-members visibility:chapter-member chapter:<CHAPTER_A>
/iam channel channel:#national-members visibility:member
/iam channel channel:#private visibility:private
/iam show
```

Expected:

- every response is ephemeral;
- `boundBy` and a canonical ISO `boundAt` are present;
- `/iam show` matches the requested mappings;
- the nationwide `member` mapping warns that chapter-limited material is unavailable there.

Restart the service once and repeat `/iam show` to verify persistence and schema reload.

## Checkpoint 12 — verify effective classes and channel audience

Run `/whoami` as the organizer in each channel and record all five views.

Expected:

- `#chapter-organizers`: effective `<CHAPTER_A>:organizer`, audience
  `chapter-organizer:<CHAPTER_A>`;
- `#chapter-members`: held organizer remains visible in the union, but effective role is rounded to
  `<CHAPTER_A>:member`; audience is `chapter-member:<CHAPTER_A>`;
- `#national-members`: held classes are rounded to member; audience is nationwide `member`;
- `#private`: effective classes are empty and a normal mention does not start Cursor;
- `#unconfigured`: fallback is `chapter-organizer:<CHAPTER_A>`.

The organizer-to-member rounding in `#chapter-members` is mandatory. Stop on failure.

## Checkpoint 13 — verify union behavior

Arrange one user with login-derived `<CHAPTER_A>:member` and role-derived
`<CHAPTER_A>:organizer`. Optionally add login-derived `<CHAPTER_B>:member`.

Expected union in `/whoami`:

```text
<CHAPTER_A>:organizer
<CHAPTER_B>:member
```

It must not contain both member and organizer for the same chapter. Different chapters must not
absorb one another.

## Checkpoint 14 — inspect Cursor's invocation-scoped environment

Start a sufficiently long authorized Cursor invocation in `#chapter-members`. While it runs,
Cursor asks the operator to identify the child PID without exposing other process environments:

```bash
pgrep -af 'cursor-agent'
```

With operator approval, inspect only the two authorization keys:

```bash
sudo tr '\0' '\n' < "/proc/<CURSOR_CHILD_PID>/environ" \
  | grep -E '^XANGI_AUTHZ_(NONCE|SOCKET)='
```

Expected:

- `XANGI_AUTHZ_NONCE` exists and is non-empty;
- `XANGI_AUTHZ_SOCKET=/run/gdg-agent/<SLOT>/authz.sock`;
- no IAM path, links path, Discord token, or unrelated service secret is copied into the child.

Store the full nonce only in a local shell variable, never in chat:

```bash
NONCE="$(sudo tr '\0' '\n' < "/proc/<CURSOR_CHILD_PID>/environ" \
  | sed -n 's/^XANGI_AUTHZ_NONCE=//p')"
```

Resolve it twice during the same invocation:

```bash
curl --unix-socket "/run/gdg-agent/$SLOT/authz.sock" \
  --get --data-urlencode "nonce=$NONCE" \
  http://localhost/resolve
```

Expected both times: HTTP 200 with effective classes, mandatory `channelAudience`, guild ID, and
channel ID. The nonce is invocation-scoped, not single-use.

## Checkpoint 15 — verify revocation and two consecutive turns

After the first invocation completes, resolve the same nonce again.

Expected:

```text
HTTP 404
{"error":"unknown_or_expired"}
```

Start a second turn in the same channel and repeat the child-environment inspection.

Expected:

- a new one-shot `cursor-agent` child;
- a new nonce different from the first;
- the new nonce resolves with HTTP 200 while running;
- the old nonce remains HTTP 404;
- the second turn completes normally.

Repeat once with streaming/thinking enabled and once with it disabled. Both paths must carry the
authorization environment.

## Checkpoint 16 — verify slot isolation

Only perform this checkpoint if a second already-configured test slot exists. Do not create Stage 07
users as part of this runbook.

Resolve a slot `SLOT` nonce through the other slot's socket:

```bash
curl -i --unix-socket /run/gdg-agent/<OTHER_SLOT>/authz.sock \
  --get --data-urlencode "nonce=$NONCE" \
  http://localhost/resolve
```

Expected: HTTP 404. A 200 response is a critical isolation failure.

## Checkpoint 17 — restart and final persistence check

After operator approval, restart xangi again. Verify:

- socket owner/group/mode are still correct;
- `/iam show` retains Guild A mappings;
- `/whoami` retains the account link and produces the same five views;
- an authorized Cursor turn receives a fresh nonce;
- an unauthorized user still cannot start Cursor.

## Checkpoint 18 — result and rollback decision

Cursor presents this checklist and asks the operator to mark each item:

```text
[ ] Server checkout uses origin=https://github.com/harineko0/xangi.git
[ ] HEAD equals APPROVED_REV
[ ] Typecheck, lint, focused tests, and build passed
[ ] Cursor backend is available and one-shot for Discord
[ ] Socket ownership and mode are correct
[ ] /login works and /whoami shows five views
[ ] Role-only organizer cannot administer IAM
[ ] Guild/role/channel IAM mappings persist across restart
[ ] Organizer is rounded to member in chapter-member channel
[ ] Empty-class and private-channel invocations do not start Cursor
[ ] Streaming and non-streaming children receive nonce/socket
[ ] First nonce is revoked and second turn receives a fresh nonce
[ ] Cross-slot resolution returns 404, or was recorded NOT RUN
[ ] No secrets or IAM/link paths appeared in the Cursor child environment
```

Cursor reports one of:

- `PASS` — all mandatory items passed;
- `FAIL` — include the first failing checkpoint, exact evidence, and whether the service was stopped;
- `BLOCKED` — state the missing operator action or infrastructure;
- `PASS WITH NOT-RUN` — only slot isolation may be not run, with the reason recorded.

Do not mark Stage 04 complete on `FAIL` or `BLOCKED`.

### Optional rollback

Rollback is a separate operator decision. Cursor must not perform it automatically. If requested,
show a plan that restores `PREVIOUS_REV`, `PREVIOUS_BRANCH`, and `PREVIOUS_ORIGIN` without discarding
changes, then wait for explicit approval before each mutation. Preserve logs and the E2E result
before rollback.
