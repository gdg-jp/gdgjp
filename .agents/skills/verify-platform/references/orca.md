# Orca procedure for the local stack

Resolve Orca with the `orca-cli` skill, then load its bundled guide and browser
reference. Commands below use `orca`, the resolved executable in the macOS setup.
Use the resolved executable on another setup. Request `--help` if a flag changes.

```sh
orca skills get orca-cli --json
orca skills get orca-cli --reference references/browser.md
orca tab profile create --label gdgjp-platform-verification --scope isolated --json
```

Keep the returned profile ID. Create the tab with that profile:

```sh
orca tab create --profile "$platform_profile_id" --url http://localhost:6173/signin --json
```

Keep the returned `browserPageId` as `platform_page_id`. Set only the selected
fixture's cookies with `cookie set`. Read cookie values directly from the scratch
storage-state file. Do not print those values or retain unsanitized cookie receipts.
The Accounts cookie is `gdgjp-accounts.session_token`; the Wiki cookie is
`gdgjp-wiki-session`. Both use localhost, `/`, HttpOnly, and Lax in this stack.

```sh
orca cookie set --page "$platform_page_id" --name "$fixture_cookie_name" --value "$fixture_cookie_value" --domain localhost --path / --httpOnly --sameSite Lax --json
orca capture start --page "$platform_page_id" --json
orca goto --page "$platform_page_id" --url http://localhost:6177/s/gdg-jp/wiki/new --json
orca snapshot --page "$platform_page_id" --interactive
```

Use actual refs returned by the snapshot with `click`, `focus`, `fill`, and `type`.
Read text with a full snapshot or `exec --command read`. Actions return their
observed effects. Snapshot again after navigation, an incomplete result, or a
stale-ref error. Use `wait --text`, `--url`, or `--selector` for asynchronous results.
Use `--expect-url` for mutations when acting on a different page would matter.

```sh
orca exec --page "$platform_page_id" --command read --json
orca network --page "$platform_page_id" --limit 50 --json
orca console --page "$platform_page_id" --limit 50 --json
orca screenshot --page "$platform_page_id"
orca reload --page "$platform_page_id" --json
```

Save a screenshot's returned file into the run's evidence directory. Sanitize
network URLs, headers, and bodies before retaining them. Preserve route names,
status codes, identity labels, and boolean checks without authentication values.
Use `eval` for observations such as focus, computed styles, clipboard contents
after a copy action, and navigation timings. Never use it to submit the mapped
mutation or construct the expected UI state.

Capture document navigation timing only when `PerformanceNavigationTiming.name`
matches the page being measured. Client-side route changes retain the previous
document's timing. Record the URL, sample time, outcome, and evidence path. Failed
or incomplete samples stay explicit; they do not enter successful distributions.
These are synthetic local timings, separate from production RUM.

Close every tab created by this run before deleting its profile:

```sh
orca tab close --page "$platform_page_id" --json
orca tab profile delete --profile "$platform_profile_id" --json
orca tab list --json
orca tab profile list --json
```

Keep the cleanup receipts. Stop only the helper process started by this run, then
read its `result.json` and verify that its evidence files still exist.
