---
name: verify-wiki
description: Drive the GDG Wiki through Orca's browser with isolated local fixtures to verify viewer permissions, Markdown redaction, sharing, and page display settings. Use after Wiki UI, permission, or rendering changes.
---

# Verify Wiki

Use Orca's built-in browser for all navigation, clicks, screenshots, and browser JavaScript. Read the `orca-cli` skill and its browser reference first. Existing Playwright specs supply recipes and assertions only. Do not launch Playwright or another browser driver.

If `orca-cli` is absent from the skill catalog, resolve the CLI from
`ORCA_CLI_COMMAND` first and request its bundled guide with `skills get orca-cli --json`.
Request the browser reference with `skills get orca-cli --reference references/browser.md --json`.
Use the executable's matching guide rather than guessing commands.

## Launch

From the repository root, initialize `packages/design-system` with `git submodule update --init packages/design-system`. Install dependencies with `pnpm install --frozen-lockfile` when needed.

Start an isolated local instance and keep its shell session running:

```sh
node scripts/verification/verify-wiki.mjs --serve
```

The helper snapshots current Wiki, gdg-lib, design-system, and supporting documentation into a new temporary directory. It excludes existing state and secrets, links installed dependencies, builds the copied design system and Wiki, migrates a fresh local D1, and invokes the existing deterministic fixture setup. It honors `GDG_CI_NODE` or the repository's `gdgjp.ciNode` configuration for subprocesses.

The helper starts the built Worker through the repository's Wrangler preview path on port 6177. The preview avoids Vite dependency-optimizer reloads during browser actions. `READY` means a real authenticated GET of the seeded page returned HTTP 200 and its expected title. `ready.json` gives the source snapshot path, fixture paths, page URL, and evidence directory. No browser is launched by this script.

The source checkout's `.dev.vars`, D1, E2E cookies, and Vite cache are untouched. Port 6177 must be free. The helper refuses an occupied port instead of reusing its owner. Two verification instances cannot share that port.

## Doctor

Before launch, run this read-only prerequisite check:

```sh
node scripts/verification/verify-wiki.mjs --doctor
```

It checks the required workspace packages, dependency installation, selected Node runtime, pnpm, and exclusive availability of port 6177. After launch, use the returned `ready.json` and a plain HTTP request to its local page URL with the selected fixture cookie. A passing prelaunch doctor alone does not prove the app or a journey works.

## Drive

Use [features/README.md](features/README.md) to choose a journey. Load the version-matched Orca browser reference before issuing commands.

Create a new isolated Orca browser profile for the run. Do not reuse the user's Wiki tab or its cookies. Pin the new tab's `browserPageId` on every command. Read a snapshot, use its actual refs for clicks, and resnapshot after navigation or a stale-ref error.

`ready.json` lists `author`, `member`, and `admin` storage-state JSON paths. Set the chosen fixture's signed `gdgjp-wiki-session` cookie on the isolated tab with Orca's `cookie set` command, using its name, value, localhost domain, `/` path, HttpOnly, and Lax SameSite values. These are local test identities, not production authentication. Replacing the cookie changes the fixture identity without changing product data.

Use the production page-access HTTP API with the author's fixture cookie to establish the journey's visibility precondition. This is the same boundary the existing E2E recipes use. Browser actions and observations then go through Orca. Never use direct DOM changes to make the expected state appear.

## Evidence

The helper prints `local_data/pstack/wiki/<run-id>/`. That ignored directory retains `run.json`, `ready.json`, the authenticated response `seeded-page.html`, and the final `server.log` and `result.json`. Save the Orca action receipts, snapshots, screenshots, console output, and network observations in that same directory. Start Orca's network capture before the user action when an HTTP side effect matters.

Capture the action and its result. A screenshot of an already-set state does not prove a permission change or clipboard copy. Viewer proof combines disabled mutation controls with real 403 mutation responses. Redaction proof combines the displayed article with the clipboard content after the user clicks **Copy page contents**. Keep skipped feature-map entries explicit.

For each HTTP check, record the method, URL, request form or JSON, test fixture name,
expected test user ID, response status, and response body. Record the fixture file
path without copying its signed cookie into the proof. Save browser tab/profile
creation receipts and the cleanup state read in the run directory too.

## Cleanup

Close only this run's Orca tab and isolated profile after recording evidence. Send SIGTERM or Ctrl-C to the helper session you started. It terminates only its own detached Wrangler process group, removes only its new temporary workspace, and leaves the evidence directory intact. Do not kill by process name or remove a preexisting `.wrangler` directory. Auth fixture files disappear with scratch cleanup, so finish the browser journey first.

A hard operating-system kill can prevent cleanup. `run.json` records the exact scratch directory for diagnosis. Inspect its processes before removing it.

## Helpers

`node scripts/verification/verify-wiki.mjs --source /absolute/path/to/checkout --serve` launches another installed checkout without changing the helper. The script is executable directly too. Its only runtime modes are prerequisite checks and local serving. It never drives a browser.

## Maintenance

Use `/maintain-verification-skill` when the routes or controls change. This initial map covers reading controls and permissions. It does not cover deployed Cloudflare, Google sign-in, editor authoring, ingestion, search, external sync, or administrator workflows.
