# Antigravity Policy Bundle

Stage 14 (`docs/agents-local-refactoring/14-antigravity-backend.md`, ADR-032 in
`docs/agents-local-mvp/adr.md`) found that `agy`'s `PreToolUse` hook contract is real and
fail-closed-capable, contrary to the assumption ADR-029 recorded. Status per layer:

| Layer | Status | Where |
|---|---|---|
| `toolGate` (preToolUse) | **Mechanism implemented; capability claim pending pinned E2E** | The converger deploys this bundle's `hooks.json` and `settings.json` as root-owned per-slot files under `~/.gemini/`. The hook invokes the same `acl-gate.ts` Cursor uses, which normalizes Antigravity's `{"toolCall":{"name","args"}}` payload and emits `{"decision":"allow"/"deny"}`. `permissions.json` is the `gwsAllowlist` read through `GDG_GWS_ALLOWLIST_PATH` and deployed host-wide at `/opt/gdg-agent/lib/antigravity-permissions.json`. |
| `osSandbox` | **Not implemented.** `--sandbox` / `enableTerminalSandbox` exist in `agy`, but whether they enforce a `readBoundary: workspace`-equivalent boundary was not verified (needs a VM-based test: enable it, try to read a file outside the workspace, confirm it's denied). Recorded as `"none"` in `cli/internal/agenthost/backend.go` until that's confirmed — this is why `backend.name: antigravity` still fails `productionMinimum` and cannot be applied to production. | — |
| `slotLauncher` | Implemented (Stage 12) | `CliRunnerBase` in xangi |

Also unresolved from the ADR-032 investigation, tracked for follow-up:
- Whether `--dangerously-skip-permissions` overrides an explicit hook `"deny"` (this session's
  own tool-safety classifier blocked testing it directly). Production must not rely on the
  answer either way: xangi's `skipPermissions`/`SKIP_PERMISSIONS` defaults to off and agent-host
  does not set it.
- `agy` pin version: needs to be ≥1.1.8 for `--output-format stream-json`. The development
  machine now has 1.1.27, but that exact Linux release has not yet passed the VM E2E or been added to
  `agent-host/agent-host.json`'s `pins` — fabricating a checksum for an unpicked release would be
  worse than no pin.
- The exact PascalCase argument field names Antigravity uses for tools other than
  `run_command` (whose `CommandLine`/`Cwd` were confirmed against the installed binary's
  embedded docs) are unverified guesses in `normalizeAntigravityPayload()`. An unmatched name
  fails safe (deny), so this is a coverage gap, not a security gap.
