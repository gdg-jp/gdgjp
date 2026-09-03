---
name: wiki-query
description: Answer a question against this GDG Japan Wiki by searching index and catalog pages for relevant material, reading them, and synthesizing a cited answer — markdown page, comparison table, slide deck, or chart. Consider filing a durable answer back into pages/answers/. Use whenever the user asks a question that should be answered from the wiki's existing pages, or runs `gdg wiki query`.
---

# Wiki query

Search for relevant pages for the question, read them, and synthesize an answer with
citations. Answers can take different forms depending on the question — a markdown page, a
comparison table, a slide deck (Marp), a chart (matplotlib), a canvas. The important
insight: **good answers can be filed back into the wiki as new pages.** A comparison you
asked for, an analysis, a connection you discovered — these are valuable and shouldn't
disappear into chat history. This way explorations compound in the knowledge base just like
ingested sources do.

If filing an answer back, follow the `answers/` row of the page-types table in `AGENTS.md`:
lowest-trust tier, never primary; link to backing pages; promote durable facts to
entity/`playbooks/` pages instead of leaving them only in an answer; only create an answer
page when synthesizing ≥2 backing pages — a one-page answer should point directly there.
