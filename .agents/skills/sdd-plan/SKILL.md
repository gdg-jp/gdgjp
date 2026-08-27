---
name: sdd-plan
description: Runs the plan half of this repo's SDD loop — turning an approved Claude Code plan-mode plan into a reviewed, staged set of files under docs/<feature>/. Use when the user use "/sdd-plan" skill. Companion to sdd-implement, which consumes the files this skill produces.
---

# SDD Planner

This is the **plan** half of a two-skill loop. The companion skill, `sdd-implement`, consumes the `docs/<feature>/` files this skill produces and drives the actual implementation. Read `plan-creater` skill first.

## Why this loop exists

A single plan-mode pass produces one plan, reviewed only by the user. For a patch big
enough to span several stages, that plan benefits from an independent read by Codex
before implementation starts — catching gaps the user and Claude share a blind spot on,
not just style nits. This skill automates the mechanical parts of getting that second
opinion (writing the file, invoking Codex, folding in legitimate feedback) so the loop
is cheap enough to actually run every time, not just on the biggest patches.

## Before entering plan mode

If the feature is big enough to warrant this loop, end the plan-mode prompt with:

> we're gonna create separated plan files under docs/<feature>/.

This primes the plan itself to be written as an overview (it will become
`docs/<feature>/index.md`), not as a single flat implementation doc — dependency notes
and stage boundaries belong in it from the start, not bolted on after the fact.

## After the plan is approved

Plan mode can only write the one plan file it was given, so steps 1–2 below happen
**after** `ExitPlanMode` is approved and the session is back in normal/auto mode — not
inside plan mode itself.

1. **Copy the approved plan into the repo.** Take the plan content exactly as approved
   (the text from the just-finished turn, or the file under `~/.claude/plans/`) and
   write it verbatim to `docs/<feature>/index.md`, creating the directory. Don't edit it
   yet — Codex should review what the user actually approved, not a version already
   massaged by Claude.

2. **Send it to Codex for review.** Run non-interactively:

   ```bash
   codex exec --model "gpt-5.6-terra" --config 'model_reasoning_effort="medium"' "/code-review-and-quality Review plan files under docs/<feature>/ not only its quality but also whether it matches what product really needs.

   <the Summary of the plan creation>"
   ```

   If the command doesn't resolve as
   expected (check the output), stop and report rather than guessing at a workaround —
   confirm the working invocation once with the user and note it in this file for next
   time.

3. **Fold in the review, revise `docs/<feature>/index.md` directly.** Apply the same
   judgment the user would apply by hand: incorporate findings that are legitimate,
   and be careful about findings that cut against the product intent the plan was
   written to serve — a Codex finding is a second opinion, not an override.

4. **Confirm before splitting.** Ask the user for the go-ahead (a plain "create each
   plan file" is enough) before generating the staged files — this is a deliberate
   checkpoint, not busywork, because splitting locks in stage boundaries that are
   awkward to undo later.

5. **Create the staged files** under `docs/<feature>/` — `01-<stage>.md`,
   `02-<stage>.md`, and so on — following plan-creator's heading contract and
   dependency/parallelism notes. `docs/<feature>/index.md` stays as the overview: keep
   its dependency graph and parallel-safe groupings current, since `sdd-implement`
   reads exactly that to decide implementation order.

6. **Review the split files with Codex once more**, same invocation shape as step 2 but
   pointed at the full `docs/<feature>/` folder, and fold in findings the same way as
   step 3.

7. **Confirm, then commit.** Show the user what changed and the intended commit message
   before running `git commit` — this repo's standing rule is no commits without
   explicit ask, and that applies here even though committing is the expected last step
   of this loop. Use a Conventional Commit subject, e.g. `docs(<feature>): add SDD plan
   files`.

## Guardrails

- Never push to a remote. This skill's scope ends at a local commit; pushing is the
  user's call.
- Don't skip step 4's confirmation just because the loop is otherwise automated — it's
  the one point where the user can redirect the stage split before it's locked into
  file names that `sdd-implement` will later read.
- If `codex exec` isn't reachable or errors out, stop and report exactly what failed
  instead of proceeding without the review — a plan that skipped review silently is
  worse than one that visibly didn't get one.
