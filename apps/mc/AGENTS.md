# mc

`apps/mc/` is the remote MC audio player (`mc.gdgs.jp`): the operator controller (an
`apps/accounts/` relying party gated by chapter membership) sends commands through a
per-track `McRoom` Durable Object (one channel per track) to that track's OBS Browser Source
player page (`/play?track=<id>&t=<token>`). Clip audio
and timestamped transcripts are generated offline into `public/audio/` and `clips.json`
(`scripts/build-clips.mjs`); the source `音声/` and `原稿/` folders are never committed.
Clips added later from the controller are stored in R2 (`AUDIO`) + D1 (`uploaded_clip`).

Read `ARCHITECTURE.md` before changing module ownership or dependencies.
