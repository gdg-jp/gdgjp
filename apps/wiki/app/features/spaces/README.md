# spaces — tenant layer (knowledge platform v2, Stage 01)

Every page and source belongs to exactly one space. Reading anything first requires a role in
its space (outer layer); the v1 ACL (`sources.visibility`, page visibility / `page_access`,
`<acl src>` spans) then applies unchanged inside it (inner layer).

| File | Role |
|---|---|
| `shared.ts` | Vocabulary (kinds, roles, principals), slug rules, `spacePath()` — client-safe |
| `access.server.ts` | `resolveSpaceAccess` and the guards: `requireSpace` (routes), `requireSpaceForIdentity` (Bearer APIs), `requirePageSpace` / `requireSourceSpace` (id-addressed APIs) |
| `spaces.server.ts` | Create personal / chapter / shared spaces, update settings |
| `members.server.ts` | Membership by kind — chapter and personal spaces refuse extra principals |
| `page-defaults.server.ts` | Default grants for new pages (chapter grant in chapter spaces) |
| `review.server.ts` | `review_flags` (written by runner jobs from Stage 04) |
| `viewer.server.ts` | Per-request reachable spaces + `hide_agent_pages` / `last_space_id` |
| `shell.server.ts` | Which space the app shell and home show |
| `components/` | Current-space context, sidebar switcher, hide-agent toggle, `FormSelect` |

Space kinds:

- `shared` — `gdg-jp` (migrated data; `public:*` viewer + `user:*` editor = the v1 population) and
  user-created spaces with invited members.
- `chapter` — one per chapter; organizers own, members edit; nothing else can be added.
- `personal` — one per user; the creator only.

Rules enforced by tests: slug lookups always carry the space
(`tests/architecture/space-scoped-slug.test.ts`), inner-ACL callers also run a space guard
(`tests/architecture/space-before-inner-acl.test.ts`), `<acl src>` may only cite same-space sources.
