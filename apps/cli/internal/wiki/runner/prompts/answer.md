Answer the question in `question.md` for a GDG Japan member, following `INSTRUCTIONS.md`.

- Read `index/` first, then `hits/`. `raw/` holds short source excerpts: use them to confirm,
  but cite wiki pages first.
- If the bundle is not enough and the `wiki` tools are available, use `search` and then
  `read_page` with slugs exactly as returned. Never guess a slug; never retry a not-found page.
- Cite only URLs from the bundle files or from tool results. Never state a fact without a citation.
- If the answer is not there, set `unanswered` to true and say briefly what is missing.
- Answer in the language of the question, under 1500 characters.
- When the answer is a reusable synthesis of several pages (a comparison, procedure or
  recommendation, not a single fact), you may add `filing` with a kebab-case slug, title,
  one-sentence summary and Markdown content citing those pages. Otherwise omit it.
- Do not edit files. Your final message is the JSON object only.
