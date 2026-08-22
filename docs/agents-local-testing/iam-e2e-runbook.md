# IAM E2E runbook for the Lima agent VM

Use this checklist inside the disposable VM after `agents-local/dev/seed-iam.sh` has installed
`agents-local/dev/iam-fixture.json`. The fixture ids are synthetic and committed (`test-guild`,
`test-user`, `role-organizer`, `test-chapter`, `test-chapter-other`, `ch-chapter`, `ch-other`,
`ch-national`) — there are no secrets to keep out of this file. Stop on an unexpected agent child
or an `error` response.

## Preconditions

- `seed-iam.sh` has run and `/home/gdgagent-svc/.config/xangi/iam.json` exists.
- The check-4 specimen (`pages/test-chapter-restricted/page.md`) has been placed in
  `/srv/gdg-agent/wiki` — if `seed-iam.sh` ran before `activate.sh` and skipped it, re-run
  `seed-iam.sh` after `activate.sh`.
- Cursor credentials exist in every slot home (`cursor-agent login`, run inside the VM);
  `provision.sh` intentionally does not copy them, and the macOS host has no
  `~/.config/cursor/auth.json` to copy (its credential lives in the Keychain).
- IAM was seeded before `activate.sh`, or xangi was restarted after a re-seed — IAM is read only
  at startup.

```bash
invoke() {
  sudo -u gdgagent-svc xangi harness invoke --guild test-guild --channel "$1" \
    --user test-user --roles "$2" --message "$3" --json
}
```

Response shape is `{classes, channelAudience, slot, runId, denialReason, result?, error?}`.
**Check `error` first** — on the error branch `denialReason` is null, so a null denial reason
reads like an allow unless `error` is also checked.

## Check 1 — organizer allow path

```bash
invoke ch-chapter role-organizer \
  "Use wiki sources to answer a question that requires a chapter page."
```

Pass: `denialReason` is null; `classes` contains `{chapterId:"test-chapter", role:"organizer"}`;
`channelAudience`, `slot`, and `runId` are non-null; `result` answers from wiki content. While it
runs, confirm `/run/gdg-agent/<slot>/nonce` exists, then confirm it is removed after.

In `<wiki>/.gdgwiki/acl-gate-audit.log`, require a denied `Read` of `pages/**` with the
`wk read <rel-path>` hint followed by a `wk` shell invocation. This is simultaneously the Stage 05
fallback checkpoint.

## Check 2 — role-free deny path

```bash
invoke ch-chapter "" "This must not start an agent."
```

Pass: `denialReason === "no-held-classes"`; `classes` is empty; `slot` and `runId` are null; no
`/run/gdg-agent/*/nonce` appears; and these stay empty throughout the call:

```bash
pgrep -u gdgagent-run-0 -f cursor-agent
pgrep -u gdgagent-run-1 -f cursor-agent
```

`unbound-guild` here means the fixture was dropped: re-check `boundAt` and that
`agents-local/dev/iam-fixture.json` was actually installed to `iam.json`.

## Check 3 — cross-chapter deny

```bash
invoke ch-other role-organizer "This must not start an agent."
```

Pass: `denialReason === "no-effective-classes"` — the role resolves to a `test-chapter` class, but
`applyChannelPolicy` filters it away because `ch-other` is bound to `test-chapter-other`. Confirm
the same no-nonce and no-Cursor observations as check 2.

## Check 4 — source-visibility parity

Two specimens: any existing national page under `/srv/gdg-agent/wiki/pages/` (all `visibility:
member`) and the seeded `pages/test-chapter-restricted/page.md` (`visibility: restricted`,
`chapter_id: test-chapter`).

1. `ch-chapter` with `role-organizer`: both pages are readable — the harness answer cites both,
   and `wk ls` lists both.
2. `ch-national` with `role-organizer`: the national page is readable; the chapter-restricted page
   is **not** — `audienceKeyContains` prevents a national audience from containing any `chapter-*`
   grant.

Pass only when the harness answer and direct `wk ls` / `wk read` evaluation agree, under the same
nonce, for both pages.

## Results record

```text
Date:
VM id:
cursor-agent --version:
National page:
Chapter page: pages/test-chapter-restricted/page.md
Check 1 (allow + nonce + wk fallback): PASS | FAIL
Check 2 (no-held-classes, no child): PASS | FAIL
Check 3 (no-effective-classes, no child): PASS | FAIL
Check 4 (harness/wk visibility parity): PASS | FAIL
arm64 divergence from production x86-64:
```
