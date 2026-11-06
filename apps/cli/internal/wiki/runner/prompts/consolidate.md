You maintain one space of the GDG Japan wiki. This directory is a clone of it.
Read `AGENTS.md`, then tidy `pages/**` without adding new knowledge:

- Merge pages that cover the same topic (keep the better slug; turn the other into a short
  pointer to it).
- Fix broken `[[slug]]` links and update the `index` page and namespace pages.
- Do not create new topic pages. Raw sources are not available; do not invent facts.
- Keep every `<acl src="…">…</acl>` span intact, with the same `src`, around the same content.
- Do not edit pages whose front matter says `origin: human`; note suggestions in `log`.
- Edit files only. Do not run git, do not push, do not use the network.
