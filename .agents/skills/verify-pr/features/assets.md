# Images and live posts

Images are designed by the runner in HTML, sanitized and rendered by the Worker (locally the
render server), checked, and published to img only on approval. Live posts are generated from
the brief's timetable without an LLM.

## Sub-features

- `pr-assets-kit`: a `kit` asset job's directions render as images on `/c/<slug>/assets`;
  adopting one sets the event's kit; approval of a thumbnail calls the img fake once.
- `pr-live-posts`: `/c/<slug>/live` generates posts in timetable order, with cards.

## How to get to it (user POV)

Event **詳細** → **画像** (`/c/<slug>/assets`) and **当日実況** (`/c/<slug>/live`).

## Driving it with Orca Browser

Follow `apps/pr/e2e/assets.spec.ts` for the runner results and the control labels. Read the
img fake's state from `/dev/mock-services` before and after approval.

## Gotchas

Not executed in the recorded run. Rendering needs the companion render server, which launches
a local headless Chromium (a stand-in for Browser Rendering, not a journey driver).
