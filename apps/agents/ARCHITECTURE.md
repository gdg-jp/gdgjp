# Agents architecture

Next `app/` owns HTTP routes and the small public landing page. `/api/chat` verifies raw
webhook bytes before dispatch, and registers the continuation that flushes telemetry.
`/auth/callback` delegates to the account-link callback. URL paths and response budgets
remain defined at these entry points.

The app follows Wiki's feature ownership convention under root `features/`:

- `webhooks`: platform signature/JWT verification, replay storage, verified request context.
- `chat`: Discord/Google Chat adapters, commands, reply deadlines, handler registration.
  Handlers coordinate answer → post reply → scores → filing, in that order.
- `auth`: PKCE authorization and single-use state, Accounts HTTP client, encrypted link
  records, rotating-token leases/CAS refresh/revocation, callback presentation.
- `inquiry`: model configuration, tool-loop execution, linked-user inquiries, outcome types,
  and citation interpretation. It does not import chat handlers or filing orchestration.
- `wiki` and `connpass`: their respective API-backed answer tools. Wiki answer tools expose
  reads and source submission; answer-page write clients belong exclusively to `filing`.
- `filing`: the separate post-answer decision and Wiki note/log writes, using verified
  message IDs for idempotency and refreshing the account link before writes.
- `telemetry`: masking, observations and scores. It consumes outcomes/citations, never the
  answer or filing orchestrator; tokens remain outside observation attributes.

`lib/redis.ts` owns only the shared Redis connection and atomic storage adapter. Key
namespaces are owned by their features. Callers import concrete modules directly; there
are no compatibility barrels. Feature tests live beside the responsible feature. The
architecture test checks allowed dependencies and cycles alongside answer/write and
telemetry secrecy regressions.

The landing page uses plain HTML elements (primitives), has no domain UI widgets, and
composes the public page directly. Runtime chat features are server domain modules;
frontend component layers should be introduced when a real interactive screen needs them.
