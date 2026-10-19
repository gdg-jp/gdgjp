# screen architecture

- Routes: `home.tsx` (stage list), `stages.$stageId.tsx` (control room), `api.stages.ts`
  (create / rename / reissue / delete) are operator-only (accounts RP + chapter).
  `$invite.tsx` (speaker lobby → room at `/<three-words>/`, registered last so static paths win)
  is public behind the stage's invite words; `join.$token.ts` redirects old `/join/` links;
  `out.$stageId.$slot.$kind.tsx` (OBS Browser Source, transparent, no UI) is behind the output
  token.
- `features/stage/` owns the wire protocol, the pure room rules (`room-state.ts`: slots, ON AIR,
  timer, chat/cues, role-filtered views), the D1 stage registry, three-word stage ids, the
  reliable socket (from mc), and the publisher hook that keeps the room told which SFU
  session/tracks a page publishes. `components/control/` and `components/speaker/` hold the
  control-room and speaker widgets; the mini window is Document Picture-in-Picture.
- `features/rtc/` owns media: capture presets and device handling (`media.ts`,
  `use-local-media.ts`), the SFU client (`sfu-client.ts`, one RTCPeerConnection per page), the
  manager that publishes, pulls and rebuilds on ICE failure (`sfu-manager.ts`), the Worker-side
  SFU proxy (`sfu-proxy.server.ts`, allow-listed paths only), and link quality.
- `features/rtc/denoise/` is mic noise suppression (below).
- `features/i18n/` is the speaker-only ja/en dictionary (cookie, then Accept-Language).
- `workers/stage-room.ts` is the only Durable Object class, one per stage
  (`getByName(stageId)`). It stores the room in synchronous KV and re-sends every socket its own
  view on each change. The Worker authenticates sockets and stamps role/peer/meta headers.

Reliability rules:

- Every page publishes all four tracks (mic, camera, screen, screenAudio) once per SFU session;
  toggling devices only calls `replaceTrack`, so it never renegotiates.
- ICE failed, or disconnected for 5 s, throws the whole SFU session away and builds a new one
  (new session id → the room tells pullers → they re-pull).
- Speakers keep their participant id in localStorage and their slot across disconnects; a reload
  in the same tab skips the lobby. OBS outputs hold the last frame for 10 s while a speaker is
  gone.
- Sockets ping every second; 3.5 s without a pong forces a reconnect, forever.

Noise suppression:

- Every mic (speakers and operator talkback, never screen audio) can go through DeepFilterNet3
  in an AudioWorklet (`denoise.worklet.ts`, its own 48 kHz AudioContext). While it runs, the
  page publishes the worklet's output track and turns the browser's own `noiseSuppression`
  off (`applyConstraints`, or one mic reopen where the browser ignores that); otherwise it
  publishes the raw mic with the browser's suppression on. Either way it is one `replaceTrack`.
- Operators switch it and set its strength (attenuation limit, 6–100 dB, default on at 30 dB)
  per speaker in the participant row; the setting lives on the speaker's peer in the room and
  is never shown to the speaker. Operators' own talkback always uses the default. Pages report
  what actually runs (`denoiseState`), and the row warns when that is a fallback: loading,
  unsupported (no AudioWorklet / wasm SIMD, mobile, init failure), or overload (a frame's p95
  processing time over 2 s exceeded the 10 ms hop; sticky until switched off and on).
- The wasm is libDF built at a pinned upstream commit by `scripts/dfn/build.sh` (which also
  regenerates `df-glue.js`); it and the model go up as the `screen-dfn/<version>` GitHub
  Release. `scripts/dfn/fetch.mjs` (run by `dev` and, strictly, `build`) downloads them into
  `public/dfn/<version>/` (gitignored), checking the sha256s it pins; `_headers` makes them
  immutable. The model is served as `model.bin` so no server marks the `.tar.gz` as
  `Content-Encoding: gzip`. A new build means a new version: bump `VERSION` in fetch.mjs,
  `DFN_BASE` in `engine.ts`, and the hashes. License: `public/licenses/deepfilternet.txt`.
