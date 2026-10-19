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
