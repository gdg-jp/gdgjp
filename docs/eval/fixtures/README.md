# Eval fixtures

Synthetic, anonymous content for the e2e spaces (no real names, contacts or amounts).

| Space | Who can read | Pages |
|---|---|---|
| `e2e-eval` | public (guest), `e2e-chapter` members; spans: `e2e-chapter` organizers | `venue`, `sponsorship`, `timetable` (public / member pages with organizer-only `<acl>` spans), `staff-roster` (organizer page) |
| `e2e-eval-private` | `e2e-chapter` organizers | `next-event` |

`pages/<space>/<slug>.md` hold the page bodies; `push.sh` writes them through a runner-token
clone, so they go through `/sync` and its ACL checks like real agent pages.
