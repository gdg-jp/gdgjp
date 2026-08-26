---
name: sdd-implement
description: Orchestrates the implement half of this repo's SDD loop — for each staged plan file under docs/<feature>/, drives Claude Code non-interactively to implement it, drives another Codex session to review it, folds in legitimate feedback, and commits, using a throwaway git worktree per stage when stages can run in parallel. Use when the user use "/sdd-implement" skill. All plan files under docs/<feature>/ must already exist and be committed to main before this runs.
---

# SDD Implementer

This is the **implement** half of a two-skill loop. The companion skill, `sdd-plan`, produces the `docs/<feature>/` files this skill consumes — read
`docs/<feature>/index.md` and `docs/<feature>/todos.md` first; it carries the dependency graph and parallel-safe
groupings this skill needs to decide implementation order.

This skill runs as the orchestrator. It doesn't
write code itself — it drives a separate Claude Code to implement, and a
separate Codex to review, both non-interactively.

## Precondition

`docs/<feature>/` must already exist on `main`, committed, with an `index.md` overview
and staged files (`01-<stage>.md`, `02-<stage>.md`, ...). If it doesn't, stop and say so
rather than guessing at a plan — this skill implements plans, it doesn't write them.

## Per-stage loop

Read `docs/<feature>/index.md`'s dependency notes to group stages: stages marked
independent can run in parallel worktrees; everything else runs sequentially on `main`
directly. For each stage `docs/<feature>/xx-<stage>.md`:

1. **Set up the workspace.** Only when this stage runs in parallel with another, create
   a throwaway worktree:

   ```bash
   git worktree add ../gdgjp-sdd-<feature>-<stage> main
   ```

   Sequential stages skip this and work directly on `main`.

2. **Implement, non-interactively.** From the stage's workspace (worktree or main), pin
   a session ID up front so step 4 can resume this exact conversation later:

   ```bash
   IMPLEMENT_SESSION=$(uuidgen)
   claude -p "Implement @docs/<feature>/xx-<stage>.md as planned" \
     --session-id "$IMPLEMENT_SESSION" \
     --permission-mode auto
   ```

   Keep the prompt exactly this simple — the plan file is the spec; anything more Claude
   would need should already be in it, and extra scaffolding here just invites drift
   between what gets asked and what the plan actually says. Keep `$IMPLEMENT_SESSION`
   around (and which worktree/dir it belongs to) — it is the handle step 4 resumes.

3. **Review, non-interactively**, from a Codex subagent of GPT-5.6-Terra-Medium model:
   Prompt:
   ```
   /code-review-and-quality Review unstaged files that have implemented docs/<feature>/xx-<stage>.md

   <the implementing Claude session's final response, in full>
   ```

4. **Fold the review back into Claude, non-interactively.** This must **resume the same
   session from step 2** (`--resume "$IMPLEMENT_SESSION"`), not open a fresh one — the
   implementing Claude already has the plan, the files it touched, and its own reasoning
   loaded, so the prompt only needs to carry the review itself, not the plan file again.

   ```bash
   claude -p --resume "$IMPLEMENT_SESSION" --permission-mode auto "Codex reviewed the code you just wrote for docs/<feature>/xx-<stage>.md. Revise your implementation to address each finding below, but only where the finding is legitimate — some may misread the plan's intent or your own reasoning; push back (in your response, not in the code) on those instead of applying them. Commit after all the issues were resolved.

   <Codex's review output, in full>"
   ```

6. **If a worktree was used, land it on `main` directly — no PR.** This loop is
   deliberately branch-free from the user's point of view:

   ```bash
   git checkout main
   git merge --no-ff ../gdgjp-sdd-<feature>-<stage>
   git worktree remove ../gdgjp-sdd-<feature>-<stage>
   git branch -d <the worktree's branch>
   ```

Repeat for every stage, respecting the dependency order from `index.md`. When all stages
are done, report a summary of what was implemented and the resulting commits.

## Guardrails

- Never push to a remote or force-push — this skill's scope ends at local commits on
  `main`. Pushing is the user's call, made outside this loop.
- Merges into `main` are fast-forward or plain `--no-ff` only. No force-merge, no
  rewriting history.
- Don't let a stuck review→revise cycle spin more than twice — surface it instead.
- If a stage's implementation touches files clearly outside its own "Files to touch"
  list without an obvious reason, stop and ask before committing — that's usually a
  sign the stage boundary was wrong, not that the extra edit is fine.
