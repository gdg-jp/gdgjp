# Wiki administrator boundaries

An administrator can inspect runner status and change a space setting. An ordinary
member receives 403 for those same privileged routes.

## Sub-features

- `wiki-runner-admin` checks runner administration access and member rejection.
- `wiki-space-settings` persists and restores a space name, with member rejection.

## How to get to it (user POV)

Open `http://localhost:6177/admin/runner` for runner status. Open
`http://localhost:6177/spaces/gdg-jp/settings` for the space settings.

## Driving it with Orca Browser

Preconditions: use separate profiles with the Wiki `admin` and `member` fixtures.
Record their expected user IDs from `ready.json`. Start network capture before
any mutation.

- Runner. As admin, navigate to `/admin/runner`. Require the heading
  **Agent runner** or **エージェント runner** and the empty-runner status in the fresh database.
  As member, navigate to the same URL and require the forbidden page. Make a
  separate authenticated HTTP GET as member and require 403.
- Space settings. As admin, navigate to `/spaces/gdg-jp/settings`. Read the current
  space name. Use the name field to enter a unique temporary name, then click
  **Save** or **保存**. Require a successful settings response and the changed name after
  reload. As member, require a forbidden page and HTTP 403 for the same settings
  route. Restore the original name through the admin form and reload to verify
  restoration. Preserve both mutation responses.

## Gotchas

Admin fixture claims are local test claims. These checks do not verify production
role assignments, runner execution, VM availability, or external job completion.
Use only the seeded `gdg-jp` space in scratch. Keep the slug, member grants,
translation switch, and language unchanged during the name-only journey.
