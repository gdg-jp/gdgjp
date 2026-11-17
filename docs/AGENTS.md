# Documentation maintenance

Use [README.md](README.md) to choose a document's location. Keep current application
ownership in its `ARCHITECTURE.md` and agent workflows in `.agents/docs/`.

Preserve unfinished plans and their status evidence. Archive superseded guidance and
dated reports without presenting their commands or results as current verification.
Do not infer completion from a document's age or the existence of implementation files.

Run `pnpm check:docs` after changes. When moving a file, update Markdown links and
code consumers. The Wiki bootstrap imports a fenced value from the v1 plan; preserve
that value exactly during document-only moves. Keep eval fixtures and Roster's
widely referenced specification paths stable unless their callers migrate too.
