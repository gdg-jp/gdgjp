---
name: gdg-connpass
description: Use the gdg CLI to administer allowlisted connpass groups, events, surveys, conference data, organizer operations, async jobs, and the shared bot session. Apply to `gdg connpass` tasks.
---

# GDG connpass CLI

Use `gdg connpass` for connpass.com administration through the GDG service.

## Workflow

1. Check `gdg connpass --help` and the selected leaf command's help before execution.
2. Ensure `gdg login` has been completed. `GDG_CONNPASS_URL` is only for an intentionally selected
   development endpoint; production defaults to `https://connpass.gdgs.jp`.
3. Discover the allowlisted `GROUP_ID` and current event state with `groups list`, `events list`,
   and `events get`. Do not confuse the textual group ID with `--numeric-group-id`.
4. Set event fields with named flags only. `events`, `publish`, `sub-events`, and `conference` have
   no JSON-body flags — every field has a dedicated flag (see `events create --help`). `--from-file`
   / `--json` exist solely on `survey upsert`, whose body is a nested question array with no flag
   equivalent.
5. Most writes create asynchronous jobs. The submitted job ID is printed to stderr immediately. Use
   `--wait` when the requested outcome depends on terminal success; otherwise record the job ID and
   use `jobs get` or `jobs wait` later.
6. After any successful mutation, re-read the event and assert each intended value individually. A
   succeeded job only means the browser automation ran, not that your content was correct.

## Commands

### Discovery and core event lifecycle

```sh
gdg connpass groups list
gdg connpass groups upsert GROUP_ID [--chapter-id ID] [--numeric-group-id ID] [--enabled=BOOL]

gdg connpass events list GROUP_ID
gdg connpass events get GROUP_ID EVENT_ID
gdg connpass events create GROUP_ID --title TITLE [EVENT_FLAGS] [--wait]
gdg connpass events update GROUP_ID EVENT_ID [EVENT_FLAGS] [--wait]
gdg connpass events publish GROUP_ID EVENT_ID [--post-to-twitter] [--comment TEXT] [--wait]
gdg connpass events copy|delete|cancel GROUP_ID EVENT_ID [--wait]
gdg connpass events image GROUP_ID EVENT_ID FILE [--wait]
```

Event field flags include `--title`, `--subtitle`, `--description`, `--start-at`, `--end-at`,
`--place`, `--address`, `--capacity`, `--participant-only-info`, registration window/settings,
check-in, receipt, hashtag, contact, and invoice fields. Use `gdg connpass events create --help`
for the current complete list. Create requires `--title`. Update rejects an empty change set.

### Editing `description` and other long HTML fields

`--description`, `--participant-only-info`, and `--cancel-policy` **replace the whole field**. There
is no partial or patch update.

- Fetch the current value first: `gdg connpass events get GROUP_ID EVENT_ID`, read
  `event.description`. CLI JSON output is not HTML-escaped, so the raw output and
  `jq -r '.event.description'` show identical markup — do not write substitution patterns against
  `<` / `>`.
- Do not replace the whole body with one exact-match pattern. Change only the text around the
  relevant labels (e.g. `開催日時`, `会場`) and keep every other byte unchanged. Diff the new body
  against the original before sending and confirm only the intended sections moved.
- Pass the finished body through the single field flag:
  `gdg connpass events update GID EID --description "$(cat new-body.html)"`. Do not hand-assemble a
  JSON body for this.

### Venue information is authoritative in `place` / `address`

The source of truth for the venue is the event's `--place` and `--address`, not prose inside
`description`. Set and verify those first, then reconcile any venue text embedded in `description`
and `participantOnlyInfo` (`--participant-only-info`). If the task is "fix the venue everywhere",
treat all four — `place`, `address`, `description`, `participantOnlyInfo` — as in scope; if only
"the summary" was mentioned, confirm the scope with the requester.

### Related event resources

```sh
gdg connpass events sub-events list|get|create|cancel ...
gdg connpass events survey get GROUP_ID EVENT_ID
gdg connpass events survey upsert GROUP_ID EVENT_ID --from-file FILE|--json JSON [--wait]
gdg connpass events conference get GROUP_ID EVENT_ID
gdg connpass events conference upsert GROUP_ID EVENT_ID --is-active=BOOL [FIELDS] [--wait]
gdg connpass events stats|participants|vouchers GROUP_ID EVENT_ID
gdg connpass events message GROUP_ID EVENT_ID --subject TEXT --body TEXT [--wait]
```

Sub-event create requires `--title`. Survey upsert requires an explicit JSON source. Conference
upsert requires `--is-active` to be explicitly supplied, including when false.

When feeding `survey upsert` via `--from-file -`, pipe the raw bytes directly (`< body.json`, or
`cat body.json | gdg …`). Do not route the body through pagers, formatters, loggers, or
output-trimming wrappers — they corrupt stdin and cause `parse JSON body` errors. Prefer a real
file `--from-file body.json` so the exact bytes are inspectable and the command is re-runnable.

### Jobs and bot session

```sh
gdg connpass jobs get JOB_ID
gdg connpass jobs wait JOB_ID
gdg connpass session relogin [--wait]
```

`jobs wait` polls until success or failure and exits non-zero on failure.

- `--wait` prints `submitted job <id>` to stderr immediately and a `job <id> status=… elapsed=…`
  line on each poll. stdout carries only the final terminal-job JSON.
- connpass jobs are browser automation and routinely take 60+ seconds, sometimes over two minutes.
  Do not treat 30 seconds of silence as failure or a hang, and ignore any 30-second timeout shown
  by a calling CLI/UI.
- There is no client-side timeout; waiting ends only on a terminal status or cancellation. If the
  process is interrupted, resume with `gdg connpass jobs wait <id>` using the job ID from stderr.

## Safety and permissions

- Event publish, cancel, delete, participant messaging, group allowlisting, and bot relogin are
  consequential external actions. Execute only the exact action requested.
- `groups` and `session` are admin operations. Contributor-level event access does not imply admin
  authority.
- Boolean flags are applied only when explicitly present, so `--registration-enabled=false` and
  similar forms are meaningful.
- A job accepted by the API is not proof of success. With `--wait`, the CLI exits non-zero for a
  failed terminal job, and you must still re-read the event to confirm the intended values.
