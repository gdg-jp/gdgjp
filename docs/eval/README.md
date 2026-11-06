# Knowledge platform eval

Measures the v2 metrics (`docs/plans/knowledge-platform-v2/00-overview.md` §6) on the `e2e-`
spaces only. **A leak is a failure**: the run exits 1 when a forbidden term reaches a search
hit, an answer or a citation.

```sh
# once: fixtures (production wiki, e2e spaces only)
pnpm --filter @gdgjp/wiki exec wrangler d1 execute DB --remote --file ../../docs/eval/fixtures/setup.sql
RUNNER_TOKEN=… sh docs/eval/fixtures/push.sh

# a runner must serve answer jobs (eval jobs run at the lowest priority)
RUNNER_TYPES=answer gdg wiki runner     # or the OCI runner

AGENT_SERVICE_TOKEN=… pnpm --filter @gdgjp/agent eval -- --set ../../docs/eval/qa
gdg wiki judge --input apps/agent/eval/results/<file>.json   # local Codex, faithfulness
pnpm --filter @gdgjp/agent eval -- --search-only              # retrieval + leaks, no runner
```

The harness asks as synthetic readers (`x-agent-eval-as: guest | member:e2e-chapter |
organizer:e2e-chapter`, service token only). The wiki confines them — and their job tokens —
to `e2e-` spaces, so eval can never read real content.

## Rules

- PRs that change retrieval settings (Stage 03), runner / answer / judge prompts, or
  `RUNNER_BACKEND` / `RUNNER_MODEL` paste the eval diff in the PR description.
- Monthly: add 5 cases from Langfuse 👎 traces (`error-analysis` skill).
- Judge prompt changes re-run `judge-validation.md`.
- Freshness, integration and answer latency are sampled nightly into the wiki
  (`/admin/stats`), not here.

## Set

`qa/01-baseline.yaml`: 16 synthetic cases (organizer / member / guest pairs over `<acl>` spans,
page visibility, a private space, cross-space and out-of-space refusals). **Target 50**: the
remaining cases come from v1 Langfuse 👍 traces, which need Langfuse access (not available
when this was written).

## Baselines

| Date | Backend | Cases | hit@5 | Faithfulness | Leaks | Contains | Refusal | Unanswered | Latency p95 |
|---|---|---|---|---|---|---|---|---|---|
| 2026-11-06 | codex 0.155 (runner `answer`, MCP on), judge unvalidated | 16 | 1.00 | 0.933 | **0** | 1.00 | 0.714 | 0.00 | 77.7 s |

Baseline notes: both refusal failures (qa-0012, qa-0016) are correct "not found" answers that
also cite a neighbouring page the asker may read — strict by design (§2). One case (qa-0015)
hit the 75 s answer timeout, the degraded-reply path in production. Results:
`apps/agent/eval/results/baseline.json`.
