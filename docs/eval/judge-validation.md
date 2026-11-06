# Judge validation (validate-evaluator)

`gdg wiki judge` (prompt: `apps/cli/internal/wiki/judge/judge.md`) may be trusted only after it
agrees with human labels: TPR and TNR ≥ 0.8 on at least 50 labelled answers. Re-run this
whenever the judge prompt or backend changes, and append a row.

How to run:

1. Collect ≥ 50 answered cases (eval results files), shuffle, and label each `faithful` /
   `unfaithful` by hand against the cited pages, before looking at the judge's verdict.
2. `gdg wiki judge --input <results.json>`.
3. TPR = judge-faithful ∧ human-faithful / human-faithful; TNR = judge-unfaithful ∧
   human-unfaithful / human-unfaithful.

| Date | Prompt revision | Backend | Labelled | TPR | TNR | Adopted |
|---|---|---|---|---|---|---|
| — | initial | codex | **pending: needs 50 human labels** | — | — | not yet |
