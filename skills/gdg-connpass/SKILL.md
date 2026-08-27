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
4. Prefer named flags for ordinary event fields. Use `--from-file FILE` (or `--from-file -`) for a
   substantial JSON body, and `--json` only for small bodies; the two are mutually exclusive.
5. Most writes create asynchronous jobs. Use `--wait` when the requested outcome depends on
   terminal success; otherwise report the job ID and use `jobs get` or `jobs wait` later.
6. Re-read the event after a successful mutation when visible final state matters.

## Commands

### Discovery and core event lifecycle

```sh
gdg connpass groups list
gdg connpass groups upsert GROUP_ID [--chapter-id ID] [--numeric-group-id ID] [--enabled=BOOL]

gdg connpass events list GROUP_ID
gdg connpass events get GROUP_ID EVENT_ID
gdg connpass events create GROUP_ID --title TITLE [EVENT_FLAGS] [--from-file FILE|--json JSON] [--wait]
gdg connpass events update GROUP_ID EVENT_ID [EVENT_FLAGS] [--from-file FILE|--json JSON] [--wait]
gdg connpass events publish GROUP_ID EVENT_ID [--post-to-twitter] [--comment TEXT] [--wait]
gdg connpass events copy|delete|cancel GROUP_ID EVENT_ID [--wait]
gdg connpass events image GROUP_ID EVENT_ID FILE [--wait]
```

Event field flags include `--title`, `--subtitle`, `--description`, `--start-at`, `--end-at`,
`--place`, `--address`, `--capacity`, registration window/settings, check-in, receipt, hashtag,
contact, and invoice fields. Use `gdg connpass events create --help` for the current complete list.
Create requires a title from either `--title` or JSON. Update rejects an empty body.

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

### Jobs and bot session

```sh
gdg connpass jobs get JOB_ID
gdg connpass jobs wait JOB_ID
gdg connpass session relogin [--wait]
```

`jobs wait` polls until success or failure and exits non-zero on failure.

## Safety and permissions

- Event publish, cancel, delete, participant messaging, group allowlisting, and bot relogin are
  consequential external actions. Execute only the exact action requested.
- `groups` and `session` are admin operations. Contributor-level event access does not imply admin
  authority.
- Event flags override matching keys loaded from JSON. Boolean flags are applied only when
  explicitly present, so `--registration-enabled=false` and similar forms are meaningful.
- A job accepted by the API is not proof of success. With `--wait`, the CLI exits non-zero for a
  failed terminal job.
