# Stage 12 — local agent test environment

Use `agents-local/dev/lima-gdg-agent.yaml` to create a disposable Ubuntu 24.04 VM,
then run `provision.sh`. It installs the pinned arm64 Cursor CLI
`2026.08.11-e8db854`, copies the read-only host checkout into writable `/opt/gdgjp`,
runs the unmodified `agents-local/install.sh`, and starts xangi with the VM-only
`GDG_AGENT_HARNESS=true` systemd drop-in.

`xangi harness invoke` is the Discord-less operator entry point. It resolves the supplied
identity through the same IAM, nonce, slot, spawn, hook, and `wk` path as Discord. The
Unix socket is service-user-only (`/run/gdg-agent/harness/ctl.sock`, parent `0700`, socket
`0600`); it is not exposed through the tool server or agent environment.

Use a dedicated Accounts identity restricted to one test chapter. Keep Discord credentials
out of the VM and set `SCHEDULER_ENABLED=false`; production wiki writes are thereby contained
by the normal ACL, and the sleep cron cannot run. Record any arm64 divergence from the
production x86-64 host here rather than treating the VM as proof of production behavior.

Run the Stage 05 fallback-to-`wk` and Stage 07 sandbox/uid-isolation checkpoints in this VM.
The deny path must return an IAM denial without spawning Cursor; an allow run must show a
slot and run ID. Reset the environment with `limactl delete gdg-agent`.
