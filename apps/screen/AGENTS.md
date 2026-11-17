# screen

`apps/screen/` is the remote speaker feed for OBS (`screen.gdgs.jp`): speakers join a stage
from a shared invite link (no login) and send camera, mic and screen share through the
Cloudflare Realtime SFU; the operator control room (an `apps/accounts/` relying party gated by
chapter membership) assigns speakers to output slots, talks back (push-to-talk while ON AIR),
and sends cue cards; each slot's camera/screen/mic is a token-gated OBS Browser Source page
(`/out/<stage>/<slot>/<kind>?t=<token>`). D1 holds auth tables + the stage registry; live state
is one `StageRoom` Durable Object per stage. The SFU app secret is `REALTIME_APP_TOKEN`.

Read `ARCHITECTURE.md` before changing module ownership or dependencies.
