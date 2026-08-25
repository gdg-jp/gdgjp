# Stage 10 — sns posts/media service-layer extraction

## Context

`sns/app/lib/db.server.ts` (424 lines) contains only *read* helpers (`listPosts`, `getPost`,
`listXAccounts`, `listAccessibleChapters`, `listGooglePhotosLibraryMedia`, etc.) — there are no
`createPost`/`updatePost`/`addPostMedia`/`deletePostMedia` mutation functions anywhere in the app.
Every mutation is raw `env.DB.prepare(...)` SQL written directly inline in route actions, with the
`post_media` INSERT+R2-put pattern duplicated three times:

- `app/routes/schedule.tsx:68-218` — the entire post create/update action: raw `INSERT`/`UPDATE`
  for `posts`, `post_media` alt-text/sort-order updates, `post_media` row deletion +
  `env.MEDIA.delete`, and X-handle tag resolution (`post_media_tags` insert) — all inline in one
  action function.
- `app/routes/api.posts.ts:41-59` — a near-duplicate of the `post_media` INSERT + `env.MEDIA.put`
  pattern, for "add media to an existing post."
- `app/routes/google.photos.library.tsx:35-77` — a third near-duplicate of the same pattern, for
  copying media from a Google Photos import. Google Photos remains deferred from the CLI/API
  surface, but this existing browser mutation adapter is migrated onto the same aggregate service.

This is the highest-density extraction in the whole plan. A post and its media form one aggregate:
media count changes `waiting_for_photo`/`scheduled` eligibility, while edit/delete/publish guards
depend on post state. This stage creates one feature boundary rather than independent CRUD
services that can produce impossible intermediate states.

Depends on: none. Can run fully in parallel with everything else (see `00-overview.md`).

Read first: the `posts`/`post_media`/`post_media_tags` table definitions in
`sns/migrations/0000_init.sql` (reproduced in the API Contract section below), and
`sns/app/lib/access.server.ts`'s `requireSnsAccess` return shape (`{ user, chapter, chapters }`)
— the new service functions take an already-authorized `chapterId`, they don't re-derive access
themselves; that stays the caller's (route's) job.

## Design

### 1. Establish `app/features/posts/`

Create `post.types.ts`, `post.repository.server.ts`, `post-media.repository.server.ts`,
`post-draft.service.server.ts`, and `post-policy.ts`. Extract schedule mutations as intent-level
operations: `createDraft`, `updateDraft`, `attachMedia`, `removeMedia`, and `deleteDraft`.

The draft service validates X text, dates, chapter-owned active X account, immutable chapter/
creator fields, maximum four images, 5 MiB/image, image content type, and editable states. It
recomputes status from condition plus current media count after every draft/media mutation,
preserves `published`/`posting` guards, clears failure state only where the dashboard does, and
keeps link-preview/tag resolution orchestration behavior identical. Link preview derivation belongs
inside the aggregate service: whenever create/update changes the final text, call an injected
`fetchLinkPreview(text)` provider and persist its nullable result. Route/API callers do not submit
trusted preview metadata, so dashboard and CLI saves produce the same cards.

### 2. Storage and persistence compensation

The service owns the R2/D1 boundary. R2 put precedes row insertion and is deleted if insertion
fails. Removal first records enough metadata for compensation, applies the database mutation, and
deletes R2; a storage failure is surfaced/observable for retry rather than silently reporting full
success. Multi-media reordering uses a D1 batch so unique sort positions cannot be partially
updated. Unit tests force failures on both sides.

### 3. Update all three call sites

`schedule.tsx` and `api.posts.ts` call the new functions instead of inlining SQL. Migrate
`google.photos.library.tsx` to the same internal `attachMedia` operation as a behavior-preserving
cleanup: Google Photos remains out of the CLI/API scope, but leaving a third mutation path would
defeat the aggregate invariant this stage establishes.

### API Contract

No HTTP/CLI surface in this stage — Stage 12 calls these functions directly, so exact shapes
matter. Fields drawn from `sns/migrations/0000_init.sql`'s `posts`/`post_media` tables:

```ts
// app/features/posts/post-draft.service.server.ts
// PostDraftDependencies includes an injected linkPreviewForText(text) provider.
export type Post = {
  id: string; chapterId: number; xAccountId: string; text: string; scheduledAt: string;
  condition: "scheduled" | "photo_required";
  status: "scheduled" | "waiting_for_photo" | "posting" | "published" | "failed" | "needs_confirmation";
  createdByUserId: string; publishedXPostId: string | null; publishedAt: string | null;
  failureReason: string | null;
  linkPreviewUrl: string | null; linkPreviewTitle: string | null;
  linkPreviewDescription: string | null; linkPreviewImageUrl: string | null;
  createdAt: string; updatedAt: string;
};

export type CreateDraftInput = {
  chapterId: number; xAccountId: string; text: string; scheduledAt: string;
  condition: "scheduled" | "photo_required"; createdByUserId: string;
  tagHandles?: string[]; // normalized/resolved through the selected X account, maximum 10
};

export async function createDraft(
  deps: PostDraftDependencies,
  input: CreateDraftInput,
): Promise<Post>

export async function updateDraft(
  deps: PostDraftDependencies,
  id: string,
  patch: Partial<Pick<CreateDraftInput, "xAccountId" | "text" | "scheduledAt" | "condition" | "tagHandles">>,
): Promise<Post>

export async function deleteDraft(
  deps: PostDraftDependencies,
  id: string,
): Promise<{ ok: true } | { ok: false; error: string }> // ok:false when status is "published" or "posting"

// same feature service; media repository remains internal
export type PostMedia = {
  id: string; postId: string; r2Key: string; contentType: string; byteSize: number;
  altText: string; sortOrder: number; createdAt: string;
};

export type PostDetail = { post: Post; media: PostMedia[] };

export async function getDraft(
  deps: PostDraftDependencies,
  id: string,
): Promise<PostDetail | null>

export async function attachMedia(
  deps: PostDraftDependencies,
  postId: string,
  file: { bytes: ArrayBuffer; contentType: string; altText?: string; sortOrder: number },
): Promise<{ media: PostMedia; post: Post }>

export async function removeMedia(
  deps: PostDraftDependencies,
  mediaId: string,
): Promise<{ id: string; deleted: true; post: Post }>
```

### 制約

- Do not add Google Photos CLI/API functionality. Its existing route may only be changed to call
  the canonical aggregate service with identical behavior.
- Do not change the `posts`/`post_media`/`post_media_tags` D1 schema — this stage moves code only.
- Do not change `schedule.tsx`'s or `api.posts.ts`'s external behavior (form fields, redirect
  targets, error messages) — the dashboard/scheduling UI must work identically before and after.

## Files to touch

- `sns/app/features/posts/` (types, repositories, aggregate draft service, policy)
- `sns/app/routes/{schedule.tsx,api.posts.ts,google.photos.library.tsx}` (call canonical operations)

## Verification

1. Completion criteria: `schedule.tsx`'s action and `api.posts.ts` are both thinner — parse form →
   call one `app/features/posts/` service operation → redirect/respond — with zero change to
   observable dashboard behavior. The `post_media` INSERT+R2-put logic exists in exactly one
   place, called by all three existing mutation adapters including `google.photos.library.tsx`;
   that route remains browser-only and gains no CLI/API surface.
2. Commands:
   ```
   pnpm --filter @gdgjp/sns typecheck
   pnpm --filter @gdgjp/sns test
   ```
3. Regression tests to pin explicitly: link preview fetch/persist on create and on text update
   (including provider failure producing null fields without failing the save); `deleteDraft`'s guard against deleting a `published`/
   `posting` post; photo-required status transitions when the first/last image is added/removed;
   cross-chapter X-account rejection; fifth/oversized media rejection; and R2/D1 compensation.
4. Manual E2E: `pnpm --filter @gdgjp/sns dev`, create a scheduled post with two images through the
   dashboard exactly as before, edit it to remove one image and change its text, delete a
   *different* draft post, and confirm all three flows behave identically to before the refactor.
