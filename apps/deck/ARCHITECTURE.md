# deck architecture

Three parties meet in one `DeckRoom` Durable Object per deck (`env.DECK.getByName(deckId)`):

- **Controllers**: the phone page (`d.$deckId.tsx`) and the editor (`decks.$deckId.edit.tsx`),
  signed in as a member of the deck's chapter. They receive the layout, the OBS snapshot, the
  multi-action switch positions and the operation log, and only ever send "key X was pressed"
  (`press`, with `down`/`up` for push-to-talk), a slider value for a volume key, or `refresh`.
- **The dock** (`dock.$deckId.tsx`, an OBS custom browser dock, credential = dock token in the
  URL). It holds the only obs-websocket connection (`features/obs/obs-client.ts`) and the
  password (localStorage on that PC). `features/dock/dock-engine.ts` keeps an `ObsState` (full
  read in two request batches on connect and after structural events, patched from events
  otherwise), sends it to the room throttled, and runs the steps the room sends one run at a
  time.
- **The room** (`workers/deck-room.ts`) resolves a press against the saved layout
  (`features/room/press.ts`), so a controller cannot make the dock send anything that is not a
  key of the deck. One dock at a time (a new one replaces the old); output start times are moved
  onto the room's clock (`dockNow`).

Routes:

- `home.tsx` (deck list, create), `d.$deckId.tsx`, `decks.$deckId.edit.tsx`, `api.decks.ts`
  (create / rename / duplicate / reissue dock URL / delete), `api.decks.$deckId.layout.ts`
  (save), `api.decks.$deckId.images.ts` (upload), `images.$deckId.$imageId.ts` are behind the
  accounts session and the deck's chapter (`features/deck/access.server.ts`, 404 otherwise).
- `dock.$deckId.tsx` checks only the dock token.

Data:

- `features/deck/model.ts` is the layout document: boards (root + folders) → pages → keys by
  slot index. `parseLayout` rebuilds anything a client sends and drops what it does not know;
  the editor refuses to save keys it would drop (`editing.ts#incompleteKeys`).
- A deck is one D1 row with the layout JSON and a `version`; a save names the version it was
  based on and gets 409 when someone saved in between. Renames do not bump the version.
- `features/obs/actions.ts` lists the OBS actions (the Elgato plugin's set + hotkey + raw
  request), validates them, and derives key state; `requests.ts` turns an action into
  obs-websocket requests (toggles OBS lacks read the dock's live state). Scenes and sources are
  referenced by name with the UUID kept, so a duplicated deck works on another OBS by name.
- Key images: R2 `decks/<deck>/<image>`, rows in `deck_image`; the editor shrinks them to 256 px
  first. Duplication copies them; a save prunes unused ones older than a day.

Testing: unit tests next to the pure modules; `e2e/deck.spec.ts` drives editor → dock → phone
against `e2e/fake-obs.ts`, a minimal obs-websocket v5 server with auth, batches and events.
