---
name: gdg-wiki
description: Use the gdg CLI and its Git transport to clone, edit, synchronize, ingest, lint, and ACL-check GDG Wiki content. Apply to `gdg wiki` working-tree and raw-source workflows.
---

# GDG Wiki CLI

Use `gdg wiki` for a Git-backed local view of Wiki content. The web application's D1/R2 data is
authoritative; Git provides local editing, history, merge, and synchronization.

## Choose the workflow

- For normal page/attachment editing, read [references/git-workflow.md](references/git-workflow.md).
- For raw-source ingestion, locks, agent invocation, or ACL validation, read
  [references/ingest-workflow.md](references/ingest-workflow.md).

## Shared rules

1. Confirm the installed interface with `gdg wiki --help` and leaf-command help.
2. Ensure the operator has run `gdg login`. `GDG_WIKI_URL` is only for a deliberately selected
   development endpoint; production defaults to `https://wiki.gdgs.jp`.
3. Run clone-local commands from within the configured Wiki working tree unless a directory
   argument is required.
4. Treat generated clone instructions (`AGENTS.md`) as authoritative for page structure, index/log
   updates, visibility, and ACL markup. Read them before editing Wiki content.
5. Never lower visibility or remove `<acl>` spans merely to pass validation.

## Critical ingest invariant

Do not run `gdg wiki ingest --commit` until the derived page changes have been committed and pushed
successfully. Finalization records the source content hash as ingested, runs strict ACL checking,
clears the trace, releases the lock, and advances the queue.
