# OCI knowledge runner

`gdg wiki runner` on one Oracle Cloud Always Free VM. It leases `agent_jobs` from
wiki.gdgs.jp (`synthesize` / `consolidate` / `translate`, later `answer`), runs **Codex on a
personal ChatGPT Pro login** against a local clone, verifies ACL spans and pushes. The wiki
Worker never calls an LLM. Design: `docs/plans/knowledge-platform-v2/04-runner-and-synthesis.md`.

| File | Purpose |
|---|---|
| `cloud-init.yaml` | packages, user `runner`, `/etc/gdg/runner.env` template, systemd unit, pinned Codex |
| `systemd/gdg-runner.service` | the unit (same content as in cloud-init) |
| `scripts/install-gdg.sh` | install `gdg` from a release or a local build, plus the `git-remote-gdg-wiki` link |
| `scripts/smoke.sh` | verify Codex login, API reachability and the service without leasing a job |

## 1. Create the VM (about 10 minutes)

1. OCI console → Compute → Instances → Create, region `ap-tokyo-1`.
2. Image: Canonical Ubuntu 24.04 (aarch64). Shape: `VM.Standard.A1.Flex`, 2 OCPU / 12 GB
   (Always Free). Public IPv4 on; no inbound ports beyond SSH are needed (the runner only
   makes outbound HTTPS calls).
3. SSH key: the shared organizer key (not a personal one), so another member can rebuild it.
4. Advanced options → Management → cloud-init script: paste `cloud-init.yaml`.
5. Create, then `ssh ubuntu@<ip>` and wait for `cloud-init status --wait`.

`Out of capacity for shape VM.Standard.A1.Flex` is common in Tokyo (one AD): retry later, or
from the OCI CLI in a loop (`oci compute instance launch …` every few minutes). If no public
IPv4 was assigned, add an ephemeral one on the VNIC (Instance → Networking → IPv4 addresses).

## 2. Install gdg and the token

```sh
# release (once a cli/v* release contains `gdg wiki runner`)
sudo sh install-gdg.sh 0.7.0
# or a local build copied over with scp
GOOS=linux GOARCH=arm64 go build -C apps/cli -o /tmp/gdg ./cmd/gdg
scp /tmp/gdg infra/oci-runner/scripts/*.sh ubuntu@<ip>:
sudo sh install-gdg.sh ./gdg
```

Put the token in `/etc/gdg/runner.env` (`RUNNER_TOKEN=`, 32+ random characters, mode 0640
root:runner). It must equal the Worker secret:

```sh
openssl rand -hex 24                                   # new value
pnpm --filter @gdgjp/wiki exec wrangler secret put RUNNER_TOKEN
```

**Rotation:** set the new value on the Worker, edit `/etc/gdg/runner.env`, then
`sudo systemctl restart gdg-runner`. Jobs leased during the gap return to the queue when
their 20-minute lease expires.

## 3. Codex login (needs the Pro subscriber)

Codex runs on the subscriber's personal ChatGPT Pro plan, never an API key, so **recovery
always needs that person**. The VM has no browser; use one of:

- Device code: `sudo -u runner -H codex login --device-auth`, then open the URL on any
  device signed in as the subscriber.
- Copy a login: on the subscriber's machine run `codex login`, then
  `scp ~/.codex/auth.json ubuntu@<ip>:` and
  `sudo install -o runner -g runner -m 0600 -D auth.json /home/runner/.codex/auth.json`.
  Delete the copy afterwards.

## 4. Start and check

```sh
sudo systemctl enable --now gdg-runner
sudo sh smoke.sh
journalctl -u gdg-runner -f            # job lines: "job <id> (<type>, space <id>) started / succeeded"
```

`/admin/runner` on the wiki shows the last heartbeat, the running job and the queue. When the
heartbeat is older than 10 minutes the hourly cron posts once to `RUNNER_ALERT_WEBHOOK_URL`.

## Safety model

- The agent gets an environment without `RUNNER_*` / `GDG_*` (`runner.ChildEnv`, tested), runs
  `codex exec --sandbox workspace-write` (no network, writes only in the job directory) and
  never pushes. The runner verifies ACL spans (`verify-acl` with the job's sources as the read
  set) and is the only one that pushes; `/sync` re-checks `acl_required` on the server.
- `origin: human` pages are never changed by a runner push: `/sync` skips them and opens a
  `human-page-conflict` review flag.
- Rebuilding is the recovery for anything odd: delete the VM and repeat §1–4.
