---
name: principle-laziness-protocol
description: "Apply when refactoring, evaluating diff size, or tempted to add abstractions, layers, or signal threading. Bias toward deletion and the simplest complete solution to the root cause."
disable-model-invocation: true
---

# Laziness Protocol

- **Consolidate decisions.** Do not repeat the same choice in several places. Put it behind one source of truth and pass the result as a simple flag.
- **Remove the cause.** Choose the simplest complete solution, even when it touches more files. A smaller diff that leaves a repeated workaround is not simpler. Migrate affected callers and delete the obsolete path; avoid speculative abstractions.
