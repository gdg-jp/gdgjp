# Directory structure: good vs. bad examples

Grounding examples for **AGENTS.md rule 8** ("Never mirror `raw/`'s own structure"), the
≥3-sibling rule (rule 6), **Slug uniqueness (global)** in `AGENTS.md`, and the
**Meeting minutes** rules in `SKILL.md` (no per-date pages; verbatim reproduction only
for genuinely time-ordered content). Read this when deciding whether/how to group event
child pages, or how to file a dated meeting-minutes source.

## Good: group by topic (one page per topic, not per source date)

`raw/` for the Innovative Crosstalk Jamboree event is a flat pile of loosely-named files
(`swag.md`, `Idea.md`, weekly `Meeting Minutes`, per-person tweet drafts, `HR.md`,
`シフト.md`, `フロア図.md`, ...) with no consistent internal structure at all.

The Wiki layer regroups all of that **by functional topic**, independent of how those
facts happened to be split across raw files:

```
pages/events/2026-08-02-innovative-crosstalk-jamboree-geeks-26/
├── page.md                  (short overview + links)
├── swag/
│   ├── page.md               slug: swag
│   └── idea/page.md          slug: idea  (candidate-price survey, split out under swag/)
├── promotion/
│   ├── page.md               slug: promotion
│   └── <tweet-draft>/page.md (18+ per-tweet example pages)
├── day-of-ops/
│   ├── page.md               slug: day-of-ops
│   ├── hr/page.md
│   ├── floor-plan/page.md
│   ├── shift-schedule/page.md
│   └── supplies-checklist/page.md
├── staffing/page.md
├── streaming/page.md
└── social-event/page.md
```

Crosstalk happened to claim the bare role slugs (`swag`, `promotion`, …) first. That is
fine **only while those slugs are free globally**. Front matter `slug` is UNIQUE across
the whole wiki (`pages.slug`); nesting under a different event path does **not** avoid a
collision. A later event that also needs a swag child must pick a free slug (and matching
directory), e.g. `io-extended-osaka-swag/`, not a second bare `swag/`. Push fails with
`UNIQUE constraint failed: pages.slug` otherwise. See **Slug uniqueness (global)** in
`AGENTS.md`.

Someone asking "what was the swag plan for this event?" still lands on one topic page
instead of piecing it together across many dated meeting-minute files — that part of the
design (topic hub, not per-date pages) is what matters.

## Bad: mirror `raw/`'s own folder, duplicate existing flat pages, split by date

For the I/O Extended Osaka event, an ingest pass once created this (uncommitted, later
reverted):

```
pages/events/2026-07-18-io-extended-osaka/
├── io-extended-osaka-2026-swag/          <- WRONG shape: mirrors raw's own subfolder
│   ├── page.md                              name and nests dated minutes children
│   ├── minutes-2026-05-24-swag/page.md
│   ├── minutes-2026-05-28-swag/page.md   <- duplicate of the page below
│   └── minutes-2026-06-05-swag/page.md   <- duplicate of the page below
├── minutes-2026-05-06/page.md            <- WRONG on its own: one page per meeting
├── minutes-2026-05-12/page.md               date, i.e. mirroring the minutes source's
├── minutes-2026-05-28-swag/page.md          own cadence rather than filing facts by
├── minutes-2026-06-05-swag/page.md          topic (see Meeting minutes in SKILL.md)
└── ... (15+ more dated minutes pages, all flat)
```

Three mistakes stacked here:

1. `raw/[...I／O Extended @ Osaka]/Meeting minutes/グループ別/` (a raw-side "by group"
   subfolder) got copied into `pages/` as `io-extended-osaka-2026-swag/` — grouping by
   how `raw/` happened to be organized, not by rule 6's own criteria.
2. The new directory duplicated two pages (`minutes-2026-05-28-swag`,
   `minutes-2026-06-05-swag`) that already existed flat, instead of checking for and
   moving them (rule 6, "check whether flat sibling pages already exist").
3. Independently of (1) and (2), the whole event was already wrong: one page per meeting
   date is exactly what **Meeting minutes** in `SKILL.md` bans. A candidate-price survey,
   a staff ranking, and a final swag decision each landed on their own dated page instead
   of being merged onto one swag topic page — a reader has to open 3+ dated pages and
   reconstruct the timeline themselves to answer "what did we decide for swag?".

The correct fix: file every fact/decision/checklist from those minutes on **one** topic
page for that event's swag material — using a **globally unique** slug such as
`events/2026-07-18-io-extended-osaka/io-extended-osaka-swag/` (bare `swag` was already
taken by Crosstalk) — updating the same page across ingest passes as later minutes add
more to that topic, rather than adding a new dated page each time. Only content where
the *sequence* is the point (e.g. a day-of timeline or incident log) belongs on a single
chronological page for the event — never one page per source date.

## Also bad: collapse dates but still dump the minutes body

After deleting `minutes-*`, an intermediate fix once merged several minutes files onto
`io-extended-osaka-swag/` / `io-extended-osaka-promotion/` with an intro like
「原資料を…そのまま掲載」 and left the agenda/memo narrative intact. That removes the
per-date antipattern but **still fails query**: asking "what was the final Swag BOM?"
requires skimming meeting prose instead of reading a decisions table.

Topic hubs must be **structured operational records** (確定構成、予算、発注進捗、チャネル別計画,
etc.). Bounded artifacts (a tweet draft, a setup checklist, a staff-by-staff KPT block)
go to `kind: example` children. Do not mark the whole topic hub as `kind: example` just
because its sources were minutes files.

## Also bad: parent as 「開催N日前」 minutes replay

Restating each weekly meeting as `## 開催73日前の状況（2026-05-06時点）` on the event
overview recreates the minutes cadence on the parent. The parent stays a short overview;
dated progress rows live on the topic children.
