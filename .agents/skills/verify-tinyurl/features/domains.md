# Domains

Members see the short-link domains they can use: the system domains for everyone and the custom
domains of their chapters, each with its status. Chapter organizers can start connecting an apex
domain they own; provisioning and DNS checks run against Vercel and the public internet.

## Sub-features

- `tinyurl-domains` system domain cards (`System short-link domain`, **Active**) for every member.
- `tinyurl-domains` a chapter's custom domain card (`Short links only · <chapter slug>`,
  **Active**) visible only to that chapter's members.
- `tinyurl-domains` **Connect a domain you own** only for organizers; hidden for members.
- `tinyurl-domains` **Add Domain** dialog validation for a non-apex or reserved hostname.
- `tinyurl-domains` the custom domain appears in **Short link domain** for that chapter and makes
  its links chapter-owned (see [sharing.md](sharing.md)).
- `tinyurl-domains` per-domain actions menu (**Copy domain**, **Visit domain**; custom domains also
  **Check DNS now** and **Remove domain…**, outside the map).

## How to get to it (user POV)

Sidebar **Domains** (`http://localhost:6169/domains`). Organizers choose
**Connect a domain you own**. Each card has **Actions for <hostname>**.

## Driving it with Orca Browser

Preconditions: seed applied (domains `localhost:6169` id 100 and `verify-gw.example` id 101 for
chapter 101).

- **Organizer view.** As `owner`, `goto /domains`. Require heading **Domains**, the button
  **Connect a domain you own**, system cards `gdgs.jp`, `go.gdgs.jp`, `localhost:6169` each with
  `System short-link domain` and **Active**, and the custom card `verify-gw.example` with
  `Short links only · gdg-verify-tokyo` and **Active**. Screenshot.
- **Member view.** As `peer`, `goto /domains`. Require the same four cards and no
  **Connect a domain you own**. HTTP: `curl -s -o /dev/null -w '%{http_code}\n' -b
  "$EVIDENCE/peer.jar" -X POST -d intent=inspect -d hostname=gdg-verify.jp
  http://localhost:6169/domains` prints `403`.
- **Other chapter.** As `outsider`, `goto /domains`. Require the three system cards and no
  `verify-gw.example`. In **Create link** on `/links`, the **Short link domain** options are
  `gdgs.jp/`, `go/`, `localhost:6169/` only; as `owner` they also include `verify-gw.example/`.
- **Connect validation.** As `owner`, choose **Connect a domain you own**. Require the dialog
  **Add Domain**, `We check the current DNS and website before choosing the safest delivery mode.`,
  **Your domain**, the hint `Enter the apex domain without a path.`, and a disabled
  **Add domain**. Type `gdgs.jp`; after the debounce require
  `Enter an apex domain such as gdg-tokyo.jp.` and **Add domain** still disabled. Type
  `www.example.com` and require the same message. Close the dialog. D1: `SELECT hostname FROM
  domains ORDER BY id` is unchanged (four rows: `gdgs.jp`, `go.gdgs.jp`, `localhost:6169`,
  `verify-gw.example`).
- **Actions menu.** Open **Actions for localhost:6169** and require **Copy domain** and
  **Visit domain** only. Open **Actions for verify-gw.example** and require **Check DNS now**,
  **Copy domain**, **Visit domain**, and **Remove domain…**. Do not choose the last two (outside
  the map).

Evidence: screenshots of the organizer and member pages and the validation message; the D1
domain list; the 403 line.

## Gotchas

Typing a real apex domain (for example `gdg-verify.jp`) starts a DNS and HTTPS inspection on the
public internet; offline it reports an error, online it contacts that host. Keep to the
validation inputs above.
Without `VERCEL_TOKEN` and `VERCEL_PROJECT_ID`, every domains action except `inspect` throws
before reading its intent, so **Check DNS now**, **Remove domain…**, and **Add domain** answer a
server error locally.
A custom domain that is not `active` makes the page post `syncAll` every 10 seconds; the seeded
domain is active so this never starts.
`localhost:6169` is a fixture, not a product domain; it exists only because
`SHORT_URL_BASE=http://localhost:6169`.
