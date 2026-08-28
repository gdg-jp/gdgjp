# OST (`ost.gdgs.jp`)

Open Space Technology topic board for events.

- `/` — participant form (one field + submit). `POST` → route action → `OST_BOARD.submitTopic`.
- `/admin` — projector screen. SSR `loader` seeds the list; a WebSocket to `/ws` keeps it live.
- No auth (both screens public). No D1.

## Realtime

`workers/ost-board.ts` — `OstBoard extends DurableObject`, addressed as `getByName("default")`.
SQLite storage table `topics`. Hibernatable WebSockets: `ctx.acceptWebSocket` + `webSocket*`
handlers; `broadcast()` iterates `ctx.getWebSockets()`. `workers/app.ts` forwards `GET /ws`
(Upgrade: websocket) to the DO and re-exports the class (needed by the wrangler migration;
`vite.config.ts` sets `esbuild.keepNames`).

Validation lives in `app/lib/topics.ts` (`normalizeTopicText`, unit-tested). DO classes are
not unit-tested here — cover behavior via `e2e/`.

Local port: `5185`. `pnpm --filter @gdgjp/ost dev`.
