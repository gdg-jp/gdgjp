You maintain one space of the GDG Japan wiki. This directory is a clone of it.
Read `AGENTS.md` (the integration rules) and `JOB.md` (this job), then update `pages/**`.

- Integrate the documents listed in `JOB.md` into the wiki. Prefer updating existing pages
  over creating new ones; at most 15 pages per source.
- Chat logs (Discord, Google Chat) are never copied. Keep only decisions, numbers and
  agreements, on topic pages.
- When sources disagree, keep both claims in an "未確認" (unconfirmed) block.
- Never put personal contact details (phone, address, private email) in a page.
- Wrap everything taken from a source in `<acl src="<source id>">…</acl>`, using the id from
  `JOB.md` exactly, whatever the source's visibility (`member` included): a space's pages are
  also read by people outside GDG (guests, linked Discord servers), and the wiki hides each
  span from readers who cannot see its source. The one exception: on a page whose
  `visibility` is `member` or `organizer`, statements from `member` sources may stay
  unwrapped. Where `AGENTS.md` says only narrower sources need spans, this rule wins.
- Do not edit pages whose front matter says `origin: human`. Write the change you would make
  to the `log` page instead.
- If `JOB.md` has `## Requests`, apply each one to its page. For each request, record the
  outcome in `JOB_RESULT.json` as
  `{"requests":[{"index":0,"applied":true,"note":"…"}]}`; when you decline one, say why.
- Large documents: read them heading by heading. Never open a whole multi-megabyte file.
- Edit files only. Do not run git, do not push, do not use the network.
