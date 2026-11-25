# img feature map

`apps/img` is the chapter image library behind `img.gdgs.jp`. Chapter members upload images
on `/`, manage each one on `/i/<id>`, and share `/<id>` (or a custom slug), which anyone can
fetch without signing in. Drive these journeys in the stack that [verify-apps](../../SKILL.md)
starts with `--app img`: Vite dev with the Cloudflare plugin on `http://localhost:6175`, fresh
local D1 and R2 (miniflare), and `remoteBindings: false`. There is no Accounts server unless
the run passes `--accounts`, so signed-in identities come from `/dev/login`. The UI is English.

Every journey starts as `NOT VERIFIED`. A recipe is not execution evidence. Record status and
evidence paths under the run's evidence directory (`run.json` names it).

## Local bindings

| Binding | Local behavior | Features that depend on it |
| --- | --- | --- |
| `DB` (D1) | Full, miniflare SQLite | Everything |
| `ORIGINALS`, `DERIVED` (R2) | Full, miniflare | Upload, replace, mobile, delete, public GET, stored renditions |
| `IMAGES` (Cloudflare Images) | Low-fidelity Sharp emulation in miniflare: `info()` (dimensions), resize by width/height always as `contain`, rotate, output AVIF / WebP / JPEG / PNG. It ignores `fit`, `quality`, and `draw()` overlays, and cannot output GIF | Dimension probe on upload, format negotiation, `w` / `h` / `dpr` sizing. Not reproduced: `fit=cover/crop/pad`, `q`, `radius` corner masks, byte sizes comparable to production |
| `ACCOUNTS` (service) | Not running | Real OIDC sign-in and the CLI Bearer API (outside the map) |
| Cache API | Miniflare's local cache | Repeat GETs may be cache hits; ETag and 304 still observable |

`IMG_AUTO_MAX_WIDTH` is `0` locally (from `wrangler.toml`), so plain URLs negotiate format but
never scale down. If Sharp cannot load, `IMAGES` returns 503: uploads still succeed with no
dimensions and every transform falls back to the original. Check the URL builder's
`Before: … · 640×480` line before any delivery journey; without dimensions record the
delivery journeys as blocked by the environment, not passed.

## Identities

| Label | Fixture login (append `&return_to=<path>`) | Purpose |
| --- | --- | --- |
| `member` | `/dev/login?as=verify-img&chapter=1:dev-chapter` | Driver identity; uploads everything |
| `peer` | `/dev/login?as=verify-img-peer&chapter=1:dev-chapter:member` | Same chapter, not the uploader |
| `multi` | `/dev/login?as=verify-img-multi&chapter=1:dev-chapter&chapter=2:other-chapter` | Two chapters: chapter picker, chapter badges, re-sharing |
| `outsider` | `/dev/login?as=verify-img-outsider&chapter=2:other-chapter` | Signed in, other chapter |
| `admin` | `/dev/login?as=verify-img-admin&chapter=2:other-chapter&admin=1` | Super admin outside the chapter |
| `nochapter` | `/dev/login?as=verify-img-none&chapter=0` | Signed in, no chapter |
| anonymous | none | Public GET only |

Only `member` is in the driver's `apps.mjs`. Give every other label its own isolated Orca
profile (`orca tab profile create --label verify-img-<label> --scope isolated`). For HTTP
checks, log the same label into a curl cookie jar kept in the evidence directory:
`curl -s -c <label>.jar -o /dev/null '<origin><fixture login>&return_to=/'`. Never paste cookie
values into a report.

## Test images

Create the fixtures once per run in `<evidence>/img-fixtures/`. Save this generator there as
`make-png.mjs` (plain Node, no dependencies): it writes an RGB PNG of a solid color, with
random noise when the last argument is `1` so the file stays large after compression.

```js
import { writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
const [out, w, h, hex, noise] = process.argv.slice(2);
const width = Number(w), height = Number(h);
const base = [0, 2, 4].map((i) => Number.parseInt(hex.slice(i, i + 2), 16));
const table = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = table[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const body = Buffer.concat([Buffer.from(type), data]);
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const sum = Buffer.alloc(4); sum.writeUInt32BE(crc(body));
  return Buffer.concat([len, body, sum]);
};
const raw = Buffer.alloc((width * 3 + 1) * height);
for (let y = 0; y < height; y++) {
  for (let x = 0; x < width; x++) {
    const o = y * (width * 3 + 1) + 1 + x * 3;
    for (let i = 0; i < 3; i++) {
      const jitter = noise === "1" ? Math.floor(Math.random() * 64) - 32 : 0;
      raw[o + i] = Math.max(0, Math.min(255, base[i] + jitter));
    }
  }
}
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
ihdr[8] = 8; ihdr[9] = 2;
writeFileSync(out, Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0)),
]));
```

```sh
cd <evidence>/img-fixtures
node make-png.mjs red.png 640 480 d93025 1      # about 800 KB, main upload
node make-png.mjs blue.png 640 480 1a73e8 1     # about 850 KB, replacement
node make-png.mjs green-tall.png 360 640 1e8e3e 1  # about 630 KB, mobile variant
node make-png.mjs tiny.png 64 64 f9ab00 0       # under 1 KB, below the 10 KiB transform floor
node make-png.mjs huge.png 2600 2200 808080 1   # over 10 MiB, rejected
printf 'not an image\n' > notes.txt
shasum -a 256 *.png > sha256.txt
```

Confirm `huge.png` is larger than 10485760 bytes (`ls -l`) and record `sha256.txt`.

## Sitemap

| Route | Who reaches it | Main actions | Visible states |
| --- | --- | --- | --- |
| `/` (`?folder=unfiled`, `?folder=<id>`) | Chapter member | Upload ("Choose image", drag and drop), folder chips All / Unfiled / folders, "New folder", folder Rename / Delete, open an image | Heading "Chapter image library"; empty "No images here yet."; "Uploading your image…" / "Opening image…"; upload error alert; chapter badges when 2+ chapters; "Images could not be loaded. Refresh the page to try again." Anonymous: 302 `/signin?return_to=%2F`. No chapter: 302 `/no-chapter` |
| `/i/:id` | Uploader, member of the image's chapter, or super admin | Copy URL, Delete, Replace, Upload / Replace / Remove mobile image, Custom URL Save / Clear, Optimization URL builder, Folder select, Chapter select (2+ chapters) | Heading "Image details"; card errors as `role=alert`. Other chapter: 403. Unknown or malformed id: 404. Both use React Router's default error screen (the app has no ErrorBoundary). Anonymous: 302 to sign-in |
| `/:id` and `/:slug` | Anyone | Public GET with `w`, `h`, `dpr`, `fit`, `radius`, `q`, `f`, `variant=mobile` | Image bytes; `ETag`, `Vary`, `Link: rel=canonical` for slugs; 304 on `If-None-Match`; 404 `Not found` |
| `/api/upload`, `/api/replace/:id`, `/api/mobile/:id`, `/api/slug/:id`, `/api/move/:id`, `/api/share/:id`, `/api/delete/:id`, `/api/folders`, `/api/folders/:id` | Cookie session, same policy as `/i/:id` | Called by the dashboard | Plain-text errors shown verbatim in the UI |
| `/api/cli/v1/*` | Bearer token from Accounts | CLI image and folder CRUD | 401 `{"error":"invalid_token"}` without a valid token |
| `/api/internal/upload` | Loopback `APP_URL` only, no auth | Local stand-in for the `ImageUploadService` RPC | 404 off loopback |
| `/signin` | Anyone | Redirects to `/api/auth/signin` and Accounts | Fails locally without Accounts; not a product result |
| `/no-chapter` | Signed in without a chapter | "Join a chapter" → Accounts `/onboarding` | Heading "Join a GDG to continue" |
| `/auth/signout` | Signed in | Account menu "Sign out" | Clears `gdgjp-img-session`, 302 `/signin` |
| `/api/auth/*` | Anyone | `me`, `signin`, `callback`, `signout` | `/api/auth/me` returns `{"user":null}` when anonymous |
| `/dev/login` | Local only | Mint a dev session | 302 to `return_to` |

## Journeys

| Journey ID | Feature | Identity | Recipe | Map status |
| --- | --- | --- | --- | --- |
| `img-upload` | Upload from the library, open the detail page, gallery tile | `member` | [upload.md](upload.md) | In map |
| `img-upload-errors` | Non-image and over-10-MiB uploads | `member` | [upload.md](upload.md) | In map |
| `img-replace` | Replace bytes, same URL, new ETag | `member` | [manage.md](manage.md) | In map |
| `img-custom-slug` | Custom URL save, validation, duplicate, clear | `member` | [manage.md](manage.md) | In map |
| `img-mobile-variant` | Upload, serve, and remove the mobile image | `member`, anonymous | [manage.md](manage.md) | In map |
| `img-delete` | Delete an image; public URL and detail return 404 | `member`, anonymous | [manage.md](manage.md) | In map |
| `img-folders` | Create, filter, upload into, move, rename, delete folders; duplicate name | `member` | [folders.md](folders.md) | In map |
| `img-public-delivery` | Public GET: original, format negotiation, width and DPR, too-small passthrough, ETag 304, 404 | anonymous | [delivery.md](delivery.md) | In map |
| `img-url-builder` | Optimization URL builder: built URL, Before / After, preview | `member` | [delivery.md](delivery.md) | In map |
| `img-chapter-sharing` | Chapter visibility, peer access, re-share to another chapter clears the folder | `member`, `peer`, `multi`, `outsider` | [sharing.md](sharing.md) | In map |
| `img-super-admin` | Super admin opens an image of another chapter | `admin` | [sharing.md](sharing.md) | In map |
| `img-access` | Anonymous gate, no-chapter page, 403 / 404 detail | anonymous, `outsider`, `nochapter` | [access.md](access.md) | In map |
| `img-signout` | Sign out from the account menu | `member` | [access.md](access.md) | In map |
| `img-oidc-signin` | Real sign-in through Accounts | Accounts user | [OIDC sign-in](../oidc-signin.md) | Local with `--accounts` |
| `img-cli-api` | `api/cli/v1/images` and `folders` with a Bearer token | CLI user | none | Outside: `getCliIdentity` asks Accounts `/api/cli/v1/identity`; no local token exists without Accounts. Only the 401 without a token is checkable (recorded in [access.md](access.md)) |
| `img-transform-fidelity` | `fit=cover/crop/pad`, `q`, `radius` corner transparency, production byte sizes | anonymous | none | Outside: the local Images emulation ignores fit, quality, and draw overlays; needs real Cloudflare Images |
| `img-auto-max-width` | Plain URLs scaled to `IMG_AUTO_MAX_WIDTH` | anonymous | none | Outside: the var is `0` locally and in the current production config |
| `img-rendition-lifecycle` | 30-day `DERIVED` expiry and edge cache behavior | none | none | Outside: production R2 lifecycle and Cloudflare cache |
| `img-upload-rpc` | `ImageUploadService` RPC from other Workers | other apps | none | Outside: not user-facing; the local `/api/internal/upload` stand-in is unauthenticated test plumbing |
| `img-drag-drop` | Drop a file on the upload zone | `member` | none | Outside: Orca Browser cannot synthesize an OS file drag; the same `upload()` path is covered through "Choose image" |

The map does not cover the app launcher menu, the theme toggle, clipboard contents of
"Copy URL" / "Copy", or browser sizes other than the default desktop viewport.
