---
name: sdd-implement
description: Implements committed staged SDD plans with persistent Codex implementation and review workers. Use only for /sdd-implement after docs/feature-name/ plans exist on main.
---

# SDD Implementer

This is the **implement** half of the SDD loop; `sdd-plan` produces its input.
The orchestrator does not edit code. For every stage, it uses one implementation
worker and one review worker, both `gpt-5.6-terra` with `medium` reasoning.

Workers are persistent for their stage: record their identities and send all
related follow-ups as continuation turns to the same worker. Turn completion
does not end a worker. Replace one only if its thread is unavailable.

## Precondition

`docs/<feature>/` must be committed on `main`, including `index.md`, `todos.md`,
and numbered stage files. Otherwise stop: this skill implements plans, not writes them.
But updating plan files is not prohibited.

## Per-stage loop

Read `index.md` and `todos.md`. Run independent stages in parallel worktrees;
run all other stages sequentially on `main`. For each `xx-<stage>.md`:

1. **Set up the workspace.** For a parallel stage only, create a throwaway worktree:

   ```bash
   git worktree add ../gdgjp-sdd-<feature>-<stage> main
   ```

2. **Implement.** Spawn the implementation worker in the stage workspace and
   retain its identity. Send this initial prompt unchanged:

   ```text
   Implement docs/<feature>/xx-<stage>.md as planned. Work only in this stage's
   workspace. Run relevant validation and report the changes, tests, and any
   remaining concerns.
   ```

3. **Review.** Spawn the separate review worker in the same workspace and retain
   its identity. Send this initial prompt unchanged:

   ```text
   /code-review-and-quality Review the current implementation of
   docs/<feature>/xx-<stage>.md. Inspect the working tree and plan directly.
   Report only actionable findings, ordered by severity, or state that there
   are no blocking findings.
   ```

4. **Resolve findings.** Send the following continuation prompt to the same
   implementation worker, substituting the review output without changing the
   template. Then send its update to the same review worker as a continuation.
   Repeat until clear or the loop limit.

   ```text
   Codex reviewed the code you just wrote for docs/<feature>/xx-<stage>.md. Revise your implementation to address each finding below, but only where the finding is legitimate — some may misread the plan's intent or your own reasoning; push back (in your response, not in the code) on those instead of applying them. Commit after all the issues were resolved.

   <Codex's review output, in full>
   ```

5. **Land a worktree.** If used, merge it directly into `main` — no PR:

   ```bash
   git checkout main
   git merge --no-ff ../gdgjp-sdd-<feature>-<stage>
   git worktree remove ../gdgjp-sdd-<feature>-<stage>
   git branch -d <the worktree's branch>
   ```

   On a merge conflict, ask the same implementation worker to fix it.

After all stages, report implemented work and resulting commits.

## Guardrails

- Never push, force-push, force-merge, or rewrite history.
- 2nd review is prohibited.
- If work clearly exceeds a stage's "Files to touch" list, stop and ask before committing.
- At most two parallel processes.
