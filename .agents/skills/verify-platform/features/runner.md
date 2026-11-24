# Runner jobs with a local fake runner

A signed-in user requests work that the OCI runner performs, and sees the result. The local
stack has no runner, so the verifier acts as one over the real runner HTTP API with the
stack's test `RUNNER_TOKEN`. That API is the production boundary between the Worker and the
runner, so nothing inside the Worker is faked.

## Sub-features

- `wiki-translate-now`: on an English view, **Update the English version now** queues a
  `translate` job; the runner's translation appears on the page with **Auto-translated**.
- `wiki-runner-status`: `/admin/runner` shows the runner heartbeat and the finished job.

## How to get to it (user POV)

Open `http://localhost:6177/wiki/e2e-test-page?lang=en` as the author. Administrators open
`/admin/runner`.

## Driving it with Orca Browser

Preconditions: the platform helper is ready. Read the token from
`<ready.json scratch>/apps/wiki/.dev.vars` (`RUNNER_TOKEN`) into a shell variable; never
write it to evidence. Every runner call sends `authorization: Bearer <token>` and
`x-runner-host: verify-fake-runner`.

- Request. Author fixture cookie, `goto` the English view, start capture, click
  **Update the English version now**. Require the text `Translation requested (a few minutes)`
  and a page action POST 200.
- Lease. `GET /api/runner/jobs/next?types=translate&wait=0` returns `id`, `type` `translate`,
  `attempts`, and `payload.pageId` / `payload.sourceHash`. The same request without the token
  is 401. `GET /api/runner/pages/<pageId>` returns `titleJa` and `contentJa`.
- Translate. `POST /api/runner/pages/<pageId>/translation` with JSON `titleEn`, `contentEn`
  (a TipTap doc with the same ACL spans as `contentJa`), and `sourceHash`; require 200
  `{"ok":true}`. `POST /api/runner/jobs/<id>/result` with `{"attempts":<attempts>,
  "status":"succeeded"}`; require 200. Repeating it is 409 `lease_lost`.
- Observe. Reload the author's English view: the heading is the new `titleEn`, the body shows
  the translated text, and the sidebar shows **Auto-translated**.
- Status. `POST /api/runner/heartbeat` with `{}`. As admin, `/admin/runner` lists
  `verify-fake-runner · idle`, `translate · succeeded: 1`, and the recent job.

Evidence: action receipts, sanitized runner responses, the translated page text and
screenshot, and the admin page text.

## Gotchas

A stale `sourceHash` (the page changed after the lease) is 409 `stale_source`; read the page
again rather than forcing it. Agent requests (**エージェントに依頼**) appear only on
agent-authored pages, which the seeded fixture has none of, and synthesis needs a staged
source; both remain unmapped.
