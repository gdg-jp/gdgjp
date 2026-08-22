# Fix the agents-local local-test blockers (I-002 … I-004)

## Context

`docs/agents-local-testing/issue.md` records the first real Lima VM run of
`agents-local/dev/provision.sh`. Provisioning got as far as copying the tree, pinning
`cursor-agent 2026.08.11-e8db854`, `build:acl`, and OS user creation, then died inside
`install.sh` → `setup.sh`:

```
==> [2/4] wiki/ checkout (optional in this git tree)
    cloning wiki via 'gdg wiki clone wiki'
Error: directory /opt/gdgjp/agents-local/wiki is not empty
```

Because of that, every Stage 12 completion criterion past "VM boots" is unverified
(`xangi.service`, harness drop-in, `xangi harness invoke` allow/deny, nonce/slot/preToolUse,
`wk` fallback, sandboxed ingest).

Status of the four recorded issues:

- **I-001 (Lima YAML)** — already fixed in `agents-local` commit `6741157`; the committed
  `dev/lima-gdg-agent.yaml` has no `rosetta:` and no `virtiofs.cache:`. No work needed.
- **I-002 (no exec bit)** — `dev/provision.sh` is `100644` in the agents.git index; the working
  tree already has the `chmod +x` staged as an unstaged mode change. Needs committing.
- **I-003 / I-004** — real design fixes, below.

Two root causes to fix, not one symptom:

1. `setup.sh` step `[2/4]` still clones the **legacy `agents-local/wiki` submodule** in-place.
   It only stayed quiet in production because `wiki/.git` happens to exist there; the VM's
   `rsync --exclude .git` strips that gitlink metadata while keeping the worktree, so the
   guard fails and `gdg wiki clone` hits a non-empty directory. It also drags the host's
   submodule worktree into the VM, which contradicts "clone the production wiki inside the
   VM" (`docs/agents-local-mvp/12-local-test-environment.md`).
2. `install.sh` puts the authenticated step (`ensure_wiki_clone_and_seed`, which needs
   `gdg login`) **first** in `finish_live_host`, so an unattended first boot with no
   credentials can never reach service placement — and the only way to satisfy it is to
   inject operator secrets before provisioning, which the VM safety rules forbid
   (`agents-local/dev/README.md`).

Outcome: `provision.sh` completes unattended with zero credentials, and a single explicit
authenticated step afterwards brings up the wiki and the service. Production keeps its
current one-command install, because the second stage auto-chains whenever credentials are
already available.

## Repo split

`agents-local/` is a submodule of `gdg-jp/agents.git`. Land it as two commits/PRs:

- **agents.git**: `install.sh`, `setup.sh`, `dev/provision.sh`, `dev/activate.sh` (new),
  `dev/README.md`, `README.md`.
- **gdgjp**: mirrored `scripts/install-gdg-agent-host.sh`, docs, test updates, submodule bump.

`.github/scripts/gdg-agent-layout.test.mjs:47-53` asserts
`scripts/install-gdg-agent-host.sh` is **byte-identical** to `agents-local/install.sh` — copy,
don't re-edit. (`scripts/setup-gdg-agent.sh` is a different, smaller script and is *not*
mirrored from `agents-local/setup.sh`; leave it alone.)

## Change 1 — `agents-local/setup.sh`: drop the legacy in-tree wiki clone (I-003)

Delete the whole `[2/4]` block (`setup.sh:55-70`) including the `gdg wiki clone wiki` and
`git add wiki`. Renumber the remaining steps to `[1/3] gdg CLI`, `[2/3] xangi prerequisites +
binary`, `[3/3] uid-isolation layout`, and update the header comment (`setup.sh:5-7`) which
still documents the clone. The production worktree is `/srv/gdg-agent/wiki` and is owned
solely by `install.sh`.

Update the trailing "Remaining xangi steps" heredoc (`setup.sh:207-225`) to the new
two-stage flow: `gdg login --device` as `gdgagent-svc`, then `install.sh --activate`.

## Change 2 — `agents-local/install.sh`: split placement from activation (I-004)

Keep every existing helper; only re-order and gate. No local/VM-specific branch is added —
this is a general two-stage contract (per the Stage 12 constraint "`install.sh` にローカル分岐
を足さない").

- **Arg parsing**: accept `--activate` before `maybe_reexec_root "$@"` (which already
  re-execs with `"$@"`, so the flag survives the sudo hop). Set `ACTIVATE_ONLY=1`.
- **New predicate** `svc_credentials_available()` — true when
  `/home/gdgagent-svc/.config/gdg/credentials.json` is non-empty **or** the `SUDO_USER`
  operator home has one (reuse `operator_home()` at `install.sh:225`).
- **Split `finish_live_host` (`install.sh:505-514`)** into:
  - `place_live_host()` — stage 1, no credentials needed: `ensure_gdg_system`,
    `ensure_cursor_cli`, `ensure_xangi_fork`, `copy_operator_runtime_secrets`,
    `write_xangi_user_unit`. Then, if `svc_credentials_available || [[ -t 0 ]]`, chain into
    `activate_live_host` (preserves today's production one-command install); otherwise print
    the exact stage-2 command and finish successfully.
  - `activate_live_host()` — stage 2: `ensure_gdg_system`, `ensure_svc_gdg_login`,
    `ensure_wiki_clone_and_seed`, `ensure_xangi_setup`, `start_xangi_service`,
    `print_remaining`.
- **Move the service start out of `write_xangi_user_unit` (`install.sh:469-475`)** into a new
  `start_xangi_service()` called from stage 2. Keep the existing `DISCORD_TOKEN`-in-
  `secrets.json` condition unchanged, so a tokenless host (the VM) still never auto-starts —
  `dev/activate.sh` starts it explicitly, exactly as the Stage 12 design requires.
- **Main flow (`install.sh:573-577`)**: when `ACTIVATE_ONLY=1`, resolve `layout_dir` / `gdgjp`
  (needed by `agents_local_src()`), run `activate_live_host`, and exit — skipping apt, Node,
  `build_acl`, `create_users`, and `setup.sh`. Otherwise the flow is unchanged except
  `finish_live_host` → `place_live_host`.
- **Prefix mode is untouched**: `install.sh:573-575` still calls `ensure_wiki_clone_and_seed`,
  which short-circuits to `seed_wiki_cursor_files` — the existing test at
  `.github/scripts/gdg-agent-layout.test.mjs:171-189` keeps passing.
- Update the numbered header comment block (`install.sh:11-23`) to describe the two stages.

**Ordering invariant to preserve:** `gdg wiki clone` refuses a non-empty directory
(`cli/internal/wiki/wiki.go:210-212`), and `seed_wiki_cursor_files` writes into the worktree.
So seeding must never run before a successful clone on a live host — if the clone is skipped,
skip the seed too. That is already how `ensure_wiki_clone_and_seed` (`install.sh:353-372`)
is written; do not reorder it.

## Change 3 — `agents-local/dev/provision.sh`: unattended, no wiki, no start (I-002, I-003)

- Commit the exec bit: `git update-index --chmod=+x dev/provision.sh` in agents.git.
- rsync (`provision.sh:17`): add an anchored exclude so the host's submodule worktree never
  enters the VM —
  `rsync -a --delete --exclude .git --exclude node_modules --exclude /agents-local/wiki "$source_root/" "$target_root/"`.
- Remove the trailing explicit start + `is-active` poll (`provision.sh:45-54`). Keep the
  `DISCORD_TOKEN` refusal check, the `xangi.service.d/harness.conf` drop-in write, and the
  `systemctl --user daemon-reload` (all credential-free). End by printing the next command.

## Change 4 — `agents-local/dev/activate.sh` (new, executable)

Root-run inside the VM, on a TTY. Deliberately thin — it delegates, it does not re-implement:

1. Re-assert no `DISCORD_TOKEN` in `/home/gdgagent-svc/.config/xangi/secrets.json`.
2. `SUDO_USER=root /opt/gdgjp/agents-local/install.sh --activate`
   (`SUDO_USER=root` keeps `copy_operator_runtime_secrets`/credential-copy suppressed, same
   as `provision.sh:31`; `ensure_svc_gdg_login` then runs `gdg login --device` on the TTY for
   the dedicated test Accounts identity).
3. Resolve `svc_uid=$(id -u gdgagent-svc)` (never hardcode 999), then
   `systemctl --user daemon-reload`, `start xangi.service`, and the 5× `is-active` poll moved
   from `provision.sh`.

## Change 5 — docs

- `agents-local/dev/README.md`: three-command flow (`limactl start` → `provision.sh` →
  `activate.sh`), stating that provisioning is credential-free and that `activate.sh` is the
  point where the dedicated test Accounts identity is used. Keep the `xangi harness invoke`
  example and the "never a Discord token here" warning.
- `agents-local/README.md`: Setup section — `install.sh` is two-stage; the `wiki/` submodule
  is never populated by `setup.sh` any more.
- `docs/agents-local-mvp/12-local-test-environment.md`: `provision.sh` no longer starts xangi;
  add the activation step.
- `docs/agents-local-testing/issue.md`: mark I-001 (fixed by `6741157`) and I-002/I-003/I-004
  with their resolutions.

## Change 6 — tests

In `.github/scripts/gdg-agent-layout.test.mjs`, extend the existing
`host install.sh prefix mode…` test (its `installSrc` assertions live at lines 164-189):

- `assert.match(installSrc, /--activate/)` — the activation stage exists.
- `assert.match(installSrc, /activate_live_host/)` and `/place_live_host/`.
- Read `agents-local/setup.sh` and assert `doesNotMatch(/gdg wiki clone wiki/)` — the legacy
  in-tree clone stays gone.
- Read `agents-local/dev/provision.sh` and assert it excludes `agents-local/wiki` from rsync
  and no longer contains `systemctl --user start`.

The byte-identity assertion (lines 47-53) already guards the `scripts/` mirror.

## Verification

1. Static / unit:
   ```bash
   node --test .github/scripts/gdg-agent-layout.test.mjs
   ```
   ```bash
   pnpm ci:quick
   ```
2. Prefix-mode dry run on this Mac (proves stage 1 + seeding still work with no root, no
   credentials):
   ```bash
   GDG_SETUP_PREFIX=$(mktemp -d) GDGJP_ROOT=$PWD GDG_SKIP_CLONE=1 GDG_SKIP_BUILD=1 bash agents-local/install.sh
   ```
3. Full VM E2E — the actual issue reproduction, now expected to pass unattended:
   ```bash
   limactl delete gdg-agent; limactl start --name=gdg-agent agents-local/dev/lima-gdg-agent.yaml
   ```
   ```bash
   limactl shell gdg-agent sudo /mnt/gdgjp-src/agents-local/dev/provision.sh
   ```
   Expect: completes with no `gdg login` prompt, and `/opt/gdgjp/agents-local/wiki` does not
   exist in the VM.
   ```bash
   limactl shell gdg-agent sudo /opt/gdgjp/agents-local/dev/activate.sh
   ```
   Expect: device-login prompt for the dedicated test identity, `gdg wiki clone
   /srv/gdg-agent/wiki` succeeds, `xangi setup --apply` runs, `xangi.service` reaches active.
4. Then run the previously blocked Stage 12 checks and record the results back into
   `docs/agents-local-testing/`:
   ```bash
   limactl shell gdg-agent -- sudo -u gdgagent-svc xangi harness invoke --guild "$TEST_GUILD" --channel "$TEST_CHANNEL" --user "$TEST_USER" --roles "$TEST_ROLE" --message "Summarize the venue-cost policy." --json
   ```
   plus the deny path (no roles), the Stage 05 `wk` fallback, and the Stage 07
   sandbox/uid-isolation checkpoints.
