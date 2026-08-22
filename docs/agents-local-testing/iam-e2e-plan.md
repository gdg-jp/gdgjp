# Production-equivalent IAM E2E for the Lima agent VM (revision 2)

## Context

`docs/agents-local-testing/issue.md` says the Stage 12 VM works at the socket/CLI level but has
never exercised the real path: role → permission class → channel policy → nonce/slot → Cursor →
hook → `wk`. The only authorization result ever observed is the empty-IAM `unbound-guild` deny,
which `xangi/tests/harness-invoke.test.ts:25` already covers as unit-level wiring.

Revision 1 of this plan assumed the fixture needed real Discord snowflakes and a real Accounts
chapter id, delivered through eight `TEST_*` environment variables and a `sed` template. That was
wrong, and revision 1 was implemented before the error was caught. Two findings overturn it:

1. **Nothing on the harness path validates or resolves IDs.** `xangi/src/cli/harness-cmd.ts:11-29`
   forwards `--guild/--channel/--user/--roles` as opaque strings; `xangi/src/iam.ts:20,58` does a
   plain `Record<string, …>` lookup; `iam-schema.ts` only checks role/visibility enums and the
   canonical `boundAt`. The harness deliberately never touches the Discord client
   (`docs/agents-local-testing/index.md:271`). Readable synthetic ids work end to end.
2. **The VM wiki corpus has no chapter-restricted specimen.** Measured in the running VM:
   `/srv/gdg-agent/wiki/pages/` holds 484 pages, all `visibility: member`, none with `chapter_id`;
   all 45 `raw/` documents have null visibility and null chapterId in
   `.gdgwiki/state.json`. A real chapter id therefore buys nothing — check 4 would be vacuous.

Outcome: a fully synthetic, committed IAM fixture that needs no operator input, plus a locally
placed chapter-restricted page so check 4 has a negative specimen without touching production wiki
content. The VM becomes self-serve for an agent operator; the only remaining human step is
`cursor-agent login` inside the VM.

## Current state of the VM (verified, do not re-derive)

`activate.sh` has already succeeded: `gdg` credentials exist at
`/home/gdgagent-svc/.config/gdg/credentials.json`, `/srv/gdg-agent/wiki` is cloned, `xangi.service`
is **active**, and `/run/gdg-agent/harness/ctl.sock` is live with slot dirs `0` and `1`.
Missing: `iam.json`, and Cursor credentials in the slot homes.

## Decisions

- Fixture ids are synthetic and committed. No env vars, no template, no `sed` substitution.
- The four checks stay a manual checklist written for an agent operator, not a pass/fail script.
- Check 4's chapter-restricted specimen is a fixture page placed into the working clone and never
  committed or pushed (option A). Production wiki content is not modified.
- `install.sh` / `setup.sh` / `lib/install-layout.sh` stay free of local-only branches
  (`docs/agents-local-testing/index.md:305-306`).

## Ordering constraint

IAM is read **once at startup** — `loadGdgAuthorization(layout.iamFile, …)` at
`xangi/src/index.ts:213,232` stores it in the module-level `authorization`
(`gdg-authz.ts:38-44`); there is no reload path. Seed before the service starts, or restart it.

VM flow: `limactl start` → `provision.sh` → `seed-iam.sh` → `activate.sh`.

## Change 1 — replace the template with a committed fixture

Delete `agents-local/dev/iam-fixture.json.tmpl`. Add `agents-local/dev/iam-fixture.json` with
synthetic, self-describing ids:

```json
{
  "version": 1,
  "guilds": {
    "test-guild": {
      "chapterId": "test-chapter",
      "boundBy": "test-operator",
      "boundAt": "2026-01-01T00:00:00.000Z",
      "roles": {
        "role-organizer": { "chapterId": "test-chapter", "role": "organizer" }
      },
      "channels": {
        "ch-chapter":  { "visibility": "chapter-organizer", "chapterId": "test-chapter" },
        "ch-other":    { "visibility": "chapter-organizer", "chapterId": "test-chapter-other" },
        "ch-national": { "visibility": "member" }
      }
    }
  }
}
```

`boundAt` is a fixed literal and must stay canonical (`\.\d{3}Z$` plus a `toISOString()`
round-trip, `iam-schema.ts:29-34`) — a malformed value drops the whole guild and silently regresses
every check to `unbound-guild`.

Channel-to-check mapping: `ch-chapter` → checks 1, 2; `ch-other` → check 3 (cross-chapter, the
second chapter id exists only in this mapping); `ch-national` → check 4.

No role is mapped for the deny path — check 2 passes `--roles ""`, producing `no-held-classes`
rather than `no-effective-classes` or `unbound-guild`. Those three distinct reasons are the proof
IAM was actually consulted; `unbound-guild` is overloaded (`gdg-authz.ts:53-63,83-93,114`).

## Change 2 — shrink `agents-local/dev/seed-iam.sh`

Drop the eight required env vars, the snowflake regex, `escape_sed_replacement`, the `sed`
rendering, the `BOUND_AT` generation, the `jq` dependency, and `GDG_SEED_IAM_DRY_RUN`. What remains:

1. Require root; refuse if `/home/gdgagent-svc/.config/xangi/secrets.json` contains
   `DISCORD_TOKEN` (same wording as `provision.sh:41-45` and `activate.sh:9-12`).
2. Require the fixture next to the script; `install -d -m 0700 -o gdgagent-svc -g gdgagent-svc` the
   config dir as `install.sh:411` does; `install -m 0600 -o gdgagent-svc -g gdgagent-svc` the
   fixture to `/home/gdgagent-svc/.config/xangi/iam.json`.
3. Place the check-4 specimen: write `pages/test-chapter-restricted/page.md` into
   `/srv/gdg-agent/wiki/` with front matter `visibility: restricted` and
   `chapter_id: test-chapter`, owned so the svc user and the `gdgwiki` group can read it, mode
   `0640`. Add it to `.git/info/exclude` in the clone so it can never be committed or pushed.
   Skip with a clear message if `/srv/gdg-agent/wiki` does not exist yet (seeding runs before
   `activate.sh` on a fresh VM), and print the command to place it after activation.
4. Resolve `svc_uid=$(id -u gdgagent-svc)` (never hardcode 999). If `xangi.service` is active,
   restart it; otherwise say `activate.sh` will start it.

Keep the script free of any reference to `install.sh`.

## Change 3 — `agents-local/dev/README.md`

Four-command flow with **no env vars** on the `seed-iam.sh` line. State that the fixture ids are
synthetic and deliberately committed, that re-seeding restarts xangi because IAM is start-time
only, and that the check-4 page is a local-only fixture excluded from git. Keep the
`harness invoke` example (updated to the synthetic ids) and the "never a Discord token here"
warning.

## Change 4 — `docs/agents-local-testing/iam-e2e-runbook.md`

Rewrite against the synthetic ids. Drop the "record real IDs only in the local results record"
caution and the `TEST_*` precondition — there are no secrets left. Keep the shape: each check gives
the command, the field to read, and the pass condition.

Every invoke is
`sudo -u gdgagent-svc xangi harness invoke --guild test-guild --channel <ch> --user test-user --roles <roles> --message … --json`.
Response shape is `{classes, channelAudience, slot, runId, denialReason, result?, error?}`
(`xangi/src/harness-server.ts:21-29`). **Check `error` first** — on the error branch `denialReason`
is null (`harness-server.ts:128-135`), so an exception reads like an allow.

1. **Allow path** — `ch-chapter`, roles `role-organizer`. Pass: `denialReason` null; `classes`
   contains `{chapterId:"test-chapter", role:"organizer"}`; `channelAudience`, `slot`, `runId`
   non-null; `result` answers from wiki content. `/run/gdg-agent/<slot>/nonce` exists during the run
   (`slot-runtime.ts:45-50`) and is gone after (`gdg-authz.ts:123-125`). Evidence `wk` was used:
   in `<wiki>/.gdgwiki/acl-gate-audit.log` (`cli/internal/wiki/hooks/acl-gate.ts:153-163`) a `Read`
   on `pages/**` denied with the `wk read <rel-path>` hint, followed by a `wk` shell invocation.
   This is simultaneously the Stage 05 fallback checkpoint.
2. **Deny path** — `ch-chapter`, `--roles ""`. Pass: `denialReason === "no-held-classes"`, `classes`
   empty, `slot` and `runId` null, no nonce file appears, and `pgrep -u gdgagent-run-0 -f
   cursor-agent` (and slot 1) stays empty across the call.
3. **Cross-chapter deny** — `ch-other`, roles `role-organizer`. Pass:
   `denialReason === "no-effective-classes"` — the role grants a class but `applyChannelPolicy`
   (`iam.ts:81-108`) filters it away because the chapters differ. Same no-nonce / no-Cursor checks.
4. **Source-visibility parity** — two specimens: any existing national page (all 484 are
   `visibility: member`) and the seeded `pages/test-chapter-restricted/page.md`.
   - `ch-chapter`: both readable — harness answer cites both, `wk ls` lists both.
   - `ch-national`: the national page is readable, the chapter-restricted one is **not** —
     `audienceKeyContains` (`gdg-lib/src/acl/core.ts:179-182`) prevents a national audience from
     containing any `chapter-*` grant.
   Pass condition is agreement between the harness answer and direct evaluation via `wk ls` /
   `wk read` under the same nonce.

Close with a results template: date, VM id, `cursor-agent --version`, four verdicts, and an
"arm64 divergence" section per `12-local-test-environment.md:20-21`.

Add a precondition that `cursor-agent login` must have been run in each slot home — this is the one
remaining human step. `provision.sh` sets `SUDO_USER=root` to suppress
`copy_operator_runtime_secrets` (`install.sh:438-444`) on purpose, and the macOS host has no
`~/.config/cursor/auth.json` to copy (its credential lives in the Keychain), so the login must
happen inside the VM.

## Change 5 — doc updates

- `docs/agents-local-testing/issue.md`: point at `seed-iam.sh` and the runbook; record that the
  fixture is synthetic and why; record that check 4 uses a local-only specimen because the corpus
  has no chapter-restricted material.
- `docs/agents-local-testing/index.md:352-360`: completion criterion #1 still claims `provision.sh`
  starts xangi. Correct it to the four-step flow.
- `docs/agents-local-mvp/12-local-test-environment.md`: insert the seeding step and state that IAM
  is start-time only.

## Change 6 — tests

In `.github/scripts/gdg-agent-layout.test.mjs`, replace the fixture block at lines 208-216:

- Read `agents-local/dev/iam-fixture.json` (not `.tmpl`), `JSON.parse` it directly, assert
  `version === 1`, exactly one guild, the three channel keys, and the organizer role mapping.
- Assert the guild's `chapterId` differs from the `ch-other` channel's `chapterId`, so the
  cross-chapter check cannot be neutered by an edit.
- Assert `boundAt` round-trips: `new Date(v).toISOString() === v`.
- Keep the `seed-iam.sh` exec-bit, `0600`, `gdgagent-svc`, and no-`install.sh` assertions.
- Delete `assert.doesNotMatch(iamFixture, /\b\d{17,20}\b/)` and the placeholder-replacement parse.
- Keep `assert.doesNotMatch(installSrc, /iam\.json/)`.

## Verification

1. Static:
   ```bash
   node --test .github/scripts/gdg-agent-layout.test.mjs
   ```
   ```bash
   pnpm ci:quick
   ```
2. Prove the fixture survives xangi's validator rather than trusting `JSON.parse`:
   ```bash
   cd /Users/hari/proj/xangi && npx vitest run tests/iam.test.ts
   ```
   Add a case there (or a scratch script) that feeds `agents-local/dev/iam-fixture.json` through
   `parseIamConfig` and asserts the guild is retained.
3. VM, against the already-provisioned `gdg-agent` instance:
   ```bash
   limactl shell gdg-agent sudo /mnt/gdgjp-src/agents-local/dev/seed-iam.sh
   ```
   Expect `/home/gdgagent-svc/.config/xangi/iam.json` at `0600` svc-owned, the check-4 page present
   and git-excluded, and `xangi.service` restarted.
4. Execute the runbook end to end inside the VM and commit the filled results file into
   `docs/agents-local-testing/`. Only then are the Stage 12 IAM/authz, nonce/slot/preToolUse,
   `wk` fallback, and sandboxed-ingest criteria closed.

## Repo split

- **agents.git** (`gdg-jp/agents`, private): `dev/iam-fixture.json` (new), `dev/seed-iam.sh`,
  `dev/README.md`, and deletion of `dev/iam-fixture.json.tmpl`. Also still pending from the previous
  plan: `git update-index --chmod=+x dev/provision.sh`.
- **gdgjp** (public): `docs/agents-local-testing/*`, `docs/agents-local-mvp/12-local-test-environment.md`,
  `.github/scripts/gdg-agent-layout.test.mjs`, and the submodule pointer bump. Without the bump,
  the byte-identity assertion at `.github/scripts/gdg-agent-layout.test.mjs:47-53` compares against
  stale submodule state in CI.
