# roulette

`apps/roulette/` is the event prize lottery (`roulette.gdgs.jp`): organizers create a project
and set up to 15 prizes with a stock each (unlimited = the losing slot) and a draw mode
(standard: by what is left, custom: % per prize, or evil: chosen prizes never come out) on
`/admin/<slug>` — an `apps/accounts/` relying party gated by chapter membership, which also
shows the draw log (CSV download); visitors spin a roulette wheel once per device at the public
`/<slug>`, which never shows stock or exclusions. Runs on the Workers Free plan: D1 only (no Durable Objects, KV,
Queues or R2); each spin is one atomic D1 batch.

Read `ARCHITECTURE.md` before changing module ownership or dependencies.
