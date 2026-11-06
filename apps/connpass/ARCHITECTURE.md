# Connpass architecture

| Responsibility | Location |
| --- | --- |
| HTTP adapters, request/response formats | `app/routes/api/{admin,events,jobs}/` |
| Bearer identity, group ACL, shared event authorization | `app/features/auth/` |
| Job contracts | `app/features/jobs/job-types.ts` |
| D1 job persistence and atomic queued-job claim | `app/features/jobs/job-repository.server.ts` |
| Queue submission and local development execution | `app/features/jobs/job-submission.server.ts` |
| Job execution, browser lifecycle and failure handling | `app/features/jobs/job-runner.server.ts` |
| Redacted job response | `app/features/jobs/job-presentation.ts` |
| Browser connection and KV bot session | `app/features/connpass/{browser,session}.server.ts` |
| Synchronous browser reads, reception check-in, and login retry | `app/features/connpass/connpass-browser-read.server.ts` |
| Connpass UI automation and model parsing (QR check-in: `ui/checkin.ts`) | `app/features/connpass/ui/` |
| Luma ticket QR parsing, api.luma.com client with KV bot session and password relogin, guest check-in | `app/features/luma/{checkin-url,client.server,checkin.server}.ts` |
| Worker fetch/queue dispatch, acknowledgement/retry | `workers/app.ts` |
| pr.gdgs.jp service binding (`PrService`: update / publish event, image, survey, event message, sub-event, job status, stats, participants for an actor; group-member mail is `not_supported`) | `workers/app.ts`, `app/features/jobs/pr-service.server.ts`, `app/features/auth/rpc-access.server.ts` (same `canReadGroup` / `canWriteGroup`); contracts in `@gdgjp/gdg-lib` `pr-rpc.ts` |

- `app/routes.ts` owns public URLs. Route directory names identify the API domain.
- The job dependency direction is submission → runner → repository → contracts. The repository never invokes the runner; queue submission occurs only after insertion succeeds.
- `app/features/connpass/event-fields.ts` owns the pure HTTP/job write contract. `event-widgets.ts` owns widget readiness and DOM interactions; `event-write.ts`, `event-read.ts`, and `sub-events.ts` own their concrete operations. Callers import these modules directly.
- `POST /api/checkin` dispatches on the QR URL: connpass reception URLs go through Browser Run, Luma ticket URLs (`luma.com/check-in/evt-…?pk=g-…`) call api.luma.com directly with `fetch` (no browser). Luma events are authorized through the `luma_calendars` allowlist (calendar → chapter), mirroring `groups`.
- Browser sessions belong to the Connpass integration, shared by synchronous reads and queued writes. Account authorization is a separate concern from the bot login/session.
- Preserve the job claim, terminal-status guards, failure capture, session release/destroy, and queue acknowledgement/retry ordering when changing execution.
- Feature modules cannot import route adapters. Tests are colocated with implementations; `app/features/architecture.test.ts` guards dependency cycles, repository and pure-contract boundaries, and the public route set.
- Update this map in the same change when moving ownership.

## Frontend placement

- Domain-free reusable UI belongs in `app/components/`; domain widgets in `app/features/<domain>/components/`; composed domain route modules in `app/routes/<domain>/`; shared layouts in `app/layouts/`.
- The current `app/routes/home.tsx` is a small static API description with no reusable widgets or substantive domain page composition. `app/root.tsx` remains the framework document shell. Create the frontend directories only when code has an actual owner there.
