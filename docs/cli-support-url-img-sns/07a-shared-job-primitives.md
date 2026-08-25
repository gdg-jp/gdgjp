# Stage 07A — shared async-job primitives

## Context

The user's resolved API model keeps exactly two slow, external-provider mutations asynchronous:
TinyURL Vercel domain provisioning and SNS publish-now. Both should expose the same lifecycle and
JSON vocabulary, but SNS shipping must not depend on TinyURL provisioning or a connpass refactor.
This independently landable groundwork stage extracts only app-neutral mechanics before either new
consumer. Connpass remains unchanged; migrating its working job implementation is a separate future
cleanup, not a prerequisite for these CLI features.

Depends on: none. Stage 07 and Stage 13 depend on this stage, not on each other.

Read first: `connpass/app/lib/jobs.server.ts` for the existing status/envelope vocabulary. Treat it
as behavioral evidence, not as code that must be migrated in this stage.

## Design

### 1. Add `gdg-lib/src/jobs/`

Create `types.ts`, `state-machine.ts`, `serialization.ts`, and `index.ts`. Keep the package free of
D1, Queue, Worker `Env`, resource ids, authorization, retry leases, and dispatch logic. It owns only:

- `JobStatus = "queued" | "running" | "succeeded" | "failed"`;
- legal terminal/non-terminal transition checks;
- the generic public envelope fields shared by both apps; and
- safe JSON parsing/serialization helpers for request/result payloads.

TinyURL and SNS own their tables, conditional SQL transitions, resource-specific result types,
queue producers/consumers, authorization, and stale-running recovery.

### API Contract

```ts
export type JobStatus = "queued" | "running" | "succeeded" | "failed";

export type JobEnvelope<TType extends string, TResource extends object, TResult> = {
  id: string;
  type: TType;
  status: JobStatus;
  request: Record<string, unknown>;
  result: TResult | null;
  error: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
} & TResource;

export function canTransitionJob(from: JobStatus, to: JobStatus): boolean;
export function parseJobJson<T>(value: string | null): T | null;
```

The precise exported serialization signatures may be narrowed during implementation, but they may
not import Cloudflare app types or erase the generic request/result types to `any`.

### 制約

- Do not touch `connpass/` in this stage. Its migration is not needed to validate the shared API.
- Do not add D1 repositories, queue send helpers, lease durations, or resource authorization to
  `gdg-lib`; those invariants differ by app and remain app-owned.
- Keep this stage independently mergeable and fully unit tested before Stage 07 or Stage 13 uses it.

## Files to touch

- `gdg-lib/src/jobs/{types.ts,state-machine.ts,serialization.ts,index.ts}` (new)
- `gdg-lib/package.json` only if an explicit subpath export is required

## Verification

1. Completion criteria: the lifecycle/types serialize both planned envelopes without importing
   TinyURL, SNS, connpass, D1, Queue, or Worker types; illegal terminal transitions are rejected.
2. Commands:
   ```
   pnpm --filter @gdgjp/gdg-lib typecheck
   pnpm --filter @gdgjp/gdg-lib test
   ```
3. Regression tests pin every legal/illegal status transition and malformed/null JSON parsing.
