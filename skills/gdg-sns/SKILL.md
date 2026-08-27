---
name: gdg-sns
description: Use the gdg CLI to manage scheduled X posts, attached media, chapter X accounts, and SNS contributors. Apply to `gdg sns` workflows on sns.gdgs.jp.
---

# GDG SNS CLI

Use `gdg sns` to manage X publishing resources. Requests are synchronous and print JSON.

## Workflow

1. Confirm the installed interface with `gdg sns --help` and leaf-command help.
2. Ensure the operator has run `gdg login`. Use `GDG_SNS_URL` only for a deliberately selected
   development endpoint; production defaults to `https://sns.gdgs.jp`.
3. Discover IDs instead of guessing: use `x-accounts list` for `xAccountId`, `posts list/get` for
   post and media state, and `contributors list` before access changes.
4. For a new post, create the draft, add media in display order, inspect with `posts get`, then
   publish only when the user intends immediate publication.
5. Re-read the terminal post returned by publish and report its persisted status.

## Commands

### Posts

```sh
gdg sns posts list --chapter-id ID [--status STATUS] [--limit N] [--cursor CURSOR]
gdg sns posts create --chapter-id ID --x-account-id ID --text TEXT \
  --scheduled-at ISO_INSTANT --condition scheduled|photo_required [--tag-handle HANDLE]
gdg sns posts get POST_ID
gdg sns posts update POST_ID [--x-account-id ID] [--text TEXT] \
  [--scheduled-at ISO_INSTANT] [--condition scheduled|photo_required] [--tag-handle HANDLE]
gdg sns posts delete POST_ID
gdg sns posts publish POST_ID
```

Update changes only supplied fields. `--tag-handle` is repeatable (maximum 10) and omits `@`.
List commands return `nextCursor`; they do not auto-page.

### Media and administration

```sh
gdg sns media add POST_ID FILE --sort-order N [--alt TEXT]
gdg sns media delete MEDIA_ID

gdg sns x-accounts list --chapter-id ID
gdg sns x-accounts revoke ACCOUNT_ID --x-user-id X_USER_ID

gdg sns contributors list --chapter-id ID [--limit N] [--cursor CURSOR]
gdg sns contributors add --chapter-id ID --email EMAIL
gdg sns contributors remove --chapter-id ID --email EMAIL
```

Use meaningful alt text for informative images. Obtain media IDs from `posts get`.

## Publication and access safety

- `posts publish` is an external publication action. Do not infer authorization from a request to
  draft, edit, preview, or schedule a post.
- If publish exits non-zero after the X API rejects the request, inspect the printed persisted post.
  A `failed` or `needs_confirmation` status with `failureReason` is meaningful output. Check X
  before retrying `needs_confirmation` to avoid a duplicate post.
- `x-accounts revoke` requires the current `xUserId` as a safety confirmation.
- Contributor add/remove operations are organizer-only. Removal uses `--chapter-id` and `--email`,
  not a positional grant ID.
