# Public delivery and the URL builder

Anyone can fetch `/<id>` or `/<slug>`. Plain URLs negotiate AVIF or WebP, explicit
parameters resize or convert, `?f=original` returns the uploaded bytes, and small files pass
through untouched. The detail page's builder composes these URLs and previews the result.

## Sub-features

- `img-public-delivery`: original bytes, format negotiation and `Vary: Accept`, `w` with
  ladder snapping, `dpr`, explicit `f`, the 10 KiB passthrough floor, ETag and 304, 404.
- `img-url-builder`: the "Optimization URL builder" controls, "Built image URL", the preset
  rendition note, "Before" / "After", and the preview.

## How to get to it (user POV)

A viewer opens a shared link such as `http://localhost:6175/<id>` in any browser; no sign-in.
A member reaches the builder on `/i/<id>`: comboboxes "Width" (Auto, 160px … 4096px),
"Fit", "Quality" (Auto (82), 60 … 100), "Format" (auto, avif, webp, jpeg, png, original),
"DPR" (1×, 2×, 3×), "Variant" when a mobile image exists; textboxes "Height" and "Corner
radius"; the preview image "Optimization preview"; the line `Before: … KB · W×H` and
`After: … KB · W×H`; the textbox "Built image URL" and "Copy".

## Driving it with Orca Browser

Preconditions: `<id>` holds `blue.png` (640×480, about 850 KB, after
[manage.md](manage.md) `img-replace`) with no mobile image and no slug. Upload `tiny.png`
again from `/` and record its id `<tid>`. Save every response header file and download in
`<evidence>/img-delivery/`. `sips -g pixelWidth -g pixelHeight <file>` reads dimensions.

`img-public-delivery` (HTTP is the primary observation; Orca shows the rendered result):

1. Original: `curl -s -D orig.h 'http://localhost:6175/<id>?f=original' -o orig.png`. Require
   `Content-Type: image/png`, an `ETag`, no `Vary`, and the `blue.png` hash.
2. Negotiation: `curl -s -D avif.h -H 'Accept: image/avif,image/webp,*/*'
   http://localhost:6175/<id> -o plain.avif`. Require `Content-Type: image/avif` and `Vary:
   Accept`, size well below the original, dimensions 640×480. With `-H 'Accept: image/webp'`
   require `image/webp`; with `-H 'Accept: */*'` require `image/png`. The three ETags differ.
3. Width: `?w=320` with `Accept: */*` returns a 320×240 PNG. `?w=300` also returns 320 wide
   (snapped to the ladder). `?w=160&dpr=2` returns 320 wide. `?w=4096` returns 640 wide (never
   upscaled past the source).
4. Explicit format: `?f=jpeg` returns `image/jpeg` regardless of `Accept`, and no `Vary`.
5. Passthrough: `curl -s -D tiny.h -H 'Accept: image/avif,image/webp,*/*'
   http://localhost:6175/<tid> -o tiny.out`. Require `image/png` and the `tiny.png` hash
   (under 10 KiB, no transform).
6. Revalidation: `curl -s -o /dev/null -w '%{http_code}' -H "If-None-Match: <ETag from
   orig.h>" 'http://localhost:6175/<id>?f=original'` returns `304`.
7. Missing: `/__definitely-missing-image__` and `/zzzzzzzz` return `404` with body `Not
   found`.
8. Browser: in an anonymous profile, `goto` `http://localhost:6175/<id>` and screenshot
   `img-public.png`. `orca network` shows the document response type `image/avif` (Chromium
   advertises AVIF).
9. Fallback check: search the run's `server.log` for "Image derivation failed; serving the
   original". Any hit during steps 2 to 4 means the local Images emulation failed; record the
   journey as blocked by the environment and attach the log lines.

`img-url-builder`:

1. `member` on `/i/<id>`. Require "Before: " followed by the KB size and `· 640×480`.
   Require "Built image URL" `http://localhost:6175/<id>?fit=scale-down&f=auto` and the note
   "This combination is delivered normally, but is not stored as a preset rendition.".
2. Select "Width" → `320px`. Require "Built image URL"
   `http://localhost:6175/<id>?w=320&fit=scale-down&f=auto`, the note gone (a preset
   rendition), and "After: … · 320×240" once the preview loads.
3. Select "DPR" → `2×`. Require `dpr=2` in the URL and "After: … · 640×480".
4. Select "Format" → `original`. Require "Built image URL" `http://localhost:6175/<id>?f=original`
   and the After size equal to the Before size.
5. Independent check: `curl` the URL from step 2 with `Accept: */*`; its dimensions equal the
   preview's.

Evidence: all header files, hashes and `sips` outputs, the public screenshot, builder snapshots
after steps 1 to 4, and the `server.log` search result.

## Gotchas

- The local Images emulation always resizes with `contain` and ignores `fit`, `q`, and the
  rounded-corner `draw()` overlay, so those options are outside this map even though the
  builder offers them.
- The builder measures "After" with `fetch()`, which sends `Accept: */*`; its byte count is
  for PNG output while the preview `img` gets AVIF. Compare dimensions, not bytes.
- The detail page's "Public URL" card claims "up to 1600px", but `IMG_AUTO_MAX_WIDTH` is `0`
  locally and plain URLs are not scaled.
- Cache API hits keep serving a rendition until its key changes; replacing bytes changes the
  key through `updated_at`, metadata changes do not.
- Without a mobile image there is no device `Vary`; with one, every default response also
  varies on `Sec-CH-UA-Mobile, CF-Device-Type, User-Agent`.
