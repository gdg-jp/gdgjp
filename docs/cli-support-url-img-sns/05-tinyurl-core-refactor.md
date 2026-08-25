# Stage 05 — tinyurl core service-layer refactor

## Context

`tinyurl/` (short links at url.gdgs.jp) is mixed: `dashboard.tsx`/`tags.tsx` already call
`app/lib/db.ts`/`app/lib/analytics-engine.ts`/`app/lib/domains.ts`, but three areas have
significant business logic written directly inline in route loaders/actions instead of in
`app/lib/`:

- `app/routes/api.links.tsx:78-94` — share-principal validation (email/chapter-id regex checks)
  written inline in the action.
- `app/routes/api.links.tsx:163-223` — `applyExtras`/`createLinkWithExtras` are route-local
  functions orchestrating tag creation, folder-permission copying, and comment/permission writes,
  including a raw SQL tag-lookup fallback (`SELECT id FROM tags WHERE name = ? AND (owner_user_id
  = ? OR owner_user_id IS NULL)`) duplicated almost verbatim in `app/routes/links.$id.tsx:308-313`.
- `app/routes/links.$id.tsx:184-330` — the link-update action does field-by-field inline
  validation (URL/protocol checks duplicating `app/lib/ogp.ts`'s `validatePublicHttpUrl`, slug
  validation, tag/permission merging) directly in the route rather than through one
  `updateLinkWithExtras` service function.
- `app/routes/domains.tsx:106-157` — `upstreamReadiness`, `persistProviderState`, `syncDomain`
  (the actual Vercel domain-provisioning/verification workflow) are route-local functions, despite
  `app/lib/domains.ts` and `app/lib/domain-provider.ts` existing for exactly this purpose.

This is a pure refactor — no auth, no new routes, no behavior change from the dashboard UI's
perspective. It exists so Stages 06–08's CLI API routes have real service functions to call instead
of duplicating this logic a third time.

Depends on: none. Can run fully in parallel with Stages 01–04 (see `00-overview.md`).

Read first: `tinyurl/CLAUDE.md`'s "Link IDs / slugs" and "Authorization" sections. Existing types
to build against, already exported from `app/lib/db.ts`: `Link`, `LinkPermission`, `LinkRole`
(imported by `app/lib/permissions.ts`). Existing types from `app/lib/domains.ts`: `Domain`,
`DomainStatus`, `DnsRecord`. Existing `DomainProvider` interface from `app/lib/domain-provider.ts`:
`{ create(hostname), check(hostname), verify(hostname), remove(hostname) }`, each returning
`ProviderDomainState = { providerDomainId, verified, configured, records, error }`; obtained via
`createDomainProvider(env): DomainProvider`.

## Design

### 1. Establish `app/features/links/`

Move link types/repository operations now concentrated in `app/lib/db.ts`, link policies from
`app/lib/permissions.ts`, and the share-principal validation plus
`applyExtras`/`createLinkWithExtras` orchestration into `app/features/links/`. Use focused files:
`link.types.ts`, `link.repository.server.ts`, `link-policy.ts`, and `link.service.server.ts`.
The exported service is used by both `api.links.tsx` (existing cookie route) and Stage 06's new
CLI route. Fields, drawn
directly from `api.links.tsx`'s current form-parsing (lines 41-100): `slug`, `destinationUrl`,
`title`, `description`, `ogImageUrl`, `tagIds` (existing tag ids to attach) + `newTagNames`
(new tag names to create-then-attach), `comment` (a `comments` table row, not a link field),
`visibility` (`"private" | "public"`), `campaignChannelId`, `folderId`, `domainId`, `shares`
(each `{ principalType: "user" | "chapter", principalId: string, role: "editor" | "viewer" }`,
parsed today from a colon-joined `"type:id:role"` string on the cookie route — the new function
takes them pre-structured, and the cookie route's parsing of its form-encoded string stays in the
route, not in this function). Validate exactly what the route validates today: domain
must exist and be `active`; caller must have chapter access to a non-null `domain.ownerChapterId`
or be super-admin; each share's `principalType`/`role` must be one of the allowed enum values, and
`user` shares must look like an email, `chapter` shares must be numeric.

### 2. `updateLinkWithExtras` in the link service

Move `links.$id.tsx`'s inline update-validation into this second exported function. Reuse
`app/lib/ogp.ts`'s existing `validatePublicHttpUrl` for URL validation instead of re-deriving it
inline (the current duplication this stage is meant to remove).

### 3. Establish `app/features/domains/`

Move domain types/D1 access into `domain.repository.server.ts`, Vercel calls into
`domain-provider.server.ts`, authorization into `domain-policy.ts`, and normalization/detection/
capacity checks plus registration/synchronization into `domain.service.server.ts`. The dashboard
and Stage 07 must call the same `registerDomain` service; the CLI must not bypass apex
normalization, `DOMAINS_ENABLED`, unsafe/private destination checks, detected mode/upstream,
duplicate detection, or the Vercel project limit.

`syncDomain` returns a typed result instead of swallowing errors ambiguously:
`{ ok: true; domain: Domain } | { ok: false; domain: Domain; error: string }`. It still persists
the domain's `error` state, but Stage 07 can now mark its job failed coherently.

### API Contract

No HTTP/CLI surface in this stage — these are library function signatures that Stages 06/07 call
directly, so their exact shape matters:

```ts
// app/features/links/link.service.server.ts
export async function createLinkWithExtras(
  deps: LinkServiceDependencies,
  actor: { user: AuthUser; chapters: UserChapter[] },
  input: CreateLinkInput,
): Promise<{ ok: true; link: Link } | FeatureFailure>

export type CreateLinkInput = {
  domainId: number;
  slug: string;
  destinationUrl: string;
  title?: string | null;
  description?: string | null;
  ogImageUrl?: string | null;
  visibility: "private" | "public";
  tagIds?: number[];
  newTagNames?: string[];
  comment?: string | null;
  campaignChannelId?: number | null;
  folderId?: number | null;
  shares?: Array<{ principalType: "user" | "chapter"; principalId: string; role: "editor" | "viewer" }>;
};

export type FeatureFailure = {
  ok: false;
  code: "invalid_input" | "forbidden" | "not_found" | "conflict";
  error: string;
};

export async function updateLinkWithExtras(
  deps: LinkServiceDependencies,
  actor: { user: AuthUser; chapters: UserChapter[] },
  id: string,
  patch: Partial<Omit<CreateLinkInput, "domainId">>,
): Promise<{ ok: true; link: Link } | FeatureFailure>

// app/features/domains/domain.service.server.ts
export async function registerDomain(
  deps: DomainServiceDependencies,
  actor: { user: AuthUser; chapters: UserChapter[] },
  input: { hostname: string; chapterId: number },
): Promise<{ ok: true; domain: Domain } | FeatureFailure>

export async function syncDomain(
  deps: DomainServiceDependencies,
  domainId: number,
): Promise<
  | { ok: true; domain: Domain }
  | { ok: false; domain: Domain; error: string }
>
```

Services return a typed failure rather than throwing expected domain errors. Dashboard adapters
preserve their current messages; CLI adapters map `invalid_input`→400, `forbidden`→403,
`not_found`→404, and `conflict`→409 with `{ error }`.

### 制約

- Do not change the `links`, `tags`, `link_tags`, `link_permissions`, `folders`,
  `folder_permissions`, or `domains` D1 schemas — this stage only moves code, it adds no columns.
- Do not change `api.links.tsx` or `links.$id.tsx`'s external behavior (form field names, response
  shape, error messages) — the dashboard UI must work identically before and after. If a delegate
  session finds itself changing an error message's wording "for consistency," stop — that's an
  unrequested behavior change.
- This stage does not add any new route. CLI API routes are Stage 06's job.

## Files to touch

- `tinyurl/app/features/links/` (new feature boundary; move focused pieces out of `app/lib/db.ts`
  and `permissions.ts` only where owned by links)
- `tinyurl/app/features/domains/` (new feature boundary; move existing domain modules)
- `tinyurl/app/routes/{api.links.tsx,links.$id.tsx,domains.tsx}` (call the extracted functions
  instead of inlining the logic)
- `tinyurl/app/lib/ogp.ts` (no change expected — confirm `validatePublicHttpUrl`'s existing
  signature is reused as-is, not modified)

If a delegate session struggles with the combined diff, this splits cleanly into three independent
pieces (links/tags extraction, update-validation extraction, domain-sync extraction) since the
three touched route files share no state.

## Verification

1. Completion criteria: `api.links.tsx`, `links.$id.tsx`, and `domains.tsx` are all thinner —
   parse request → call one feature service → format response — with zero change to the
   dashboard's observable behavior.
2. Commands:
   ```
   pnpm --filter @gdgjp/tinyurl typecheck
   pnpm --filter @gdgjp/tinyurl test
   ```
3. Regression tests to pin explicitly: any existing Vitest coverage for link creation/update/tag
   handling and for `domains.tsx`'s provisioning flow — if none exists today, add unit tests for
   `createLinkWithExtras`/`updateLinkWithExtras`/`registerDomain`/`syncDomain` covering at minimum:
   slug uniqueness, invalid shares, unsafe/private domains, non-apex hostnames, capacity limit, and
   provider success/failure transitions. Service tests inject repositories/providers rather than
   mocking route globals.
4. Manual E2E: `pnpm --filter @gdgjp/tinyurl dev`, create a link with tags/folder/shares through
   the dashboard UI exactly as before, confirm it still works; edit an existing link's URL to an
   invalid one and confirm the same validation error appears as before the refactor; trigger a
   domain provisioning attempt from the dashboard and confirm the status transitions the same way.
