# deck

`apps/deck/` is the in-house Stream Deck Mobile replacement for OBS (`deck.gdgs.jp`): chapter
members edit a deck (pages, folders, keys running OBS actions, multi-actions) in the PC
editor and press keys from a phone PWA (an `apps/accounts/` relying party, chapter-gated); an
OBS custom browser dock (`/dock/<deck>?t=<token>`, no login) connects to the local
obs-websocket v5 and to the deck's `DeckRoom` Durable Object, so phone and PC need no shared
LAN. D1 holds auth tables + decks (layout JSON, versioned) + image rows; key images are in R2
(`IMAGES`).

Read `ARCHITECTURE.md` before changing module ownership or dependencies.
