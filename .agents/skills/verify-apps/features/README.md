# App feature maps

Each app has its own map: every route, who reaches it, its main actions and visible states,
and a table of stable journey IDs with recipes. Drive them in the stack from
[verify-apps](../SKILL.md). Current status and evidence belong in [coverage.json](../coverage.json).
A recipe is not execution evidence; every journey starts as `NOT VERIFIED`.

| App | Map | Local stack | Main exclusions |
| --- | --- | --- | --- |
| screen | [screen](screen/README.md) | `:6188`, operator fixture, anonymous speaker | SFU media, talkback, noise suppression, mini window |
| OST | [ost](ost/README.md) | `:6185`, seeded `verify-ost` | none beyond real sign-in |
| MC | [mc](mc/README.md) | `:6187`, bundled clips | OBS audio output, Gemini transcription |
| Deck | [deck](deck/README.md) | `:6189`, fake obs-websocket `:4467` | real OBS, PWA install, drag reordering |
| Roulette | [roulette](roulette/README.md) | `:6190` | sound and haptics, random effects |
| Img | [img](img/README.md) | `:6175`, local R2 and Images | transform fidelity, CLI Bearer API |
| Meet | [meet](meet/README.md) | `:6193` | every Google API call |
| Website | [website](website/README.md) | `:6180` | TinyURL delegation |
| Live Check-in | [live-checkin](live-checkin/README.md) | `:6194`, minted session cookies | connpass, camera QR scanning |
| Roster | [roster](roster/README.md) | `:6186` | proof of concept; refresh as stages land |

Every app also has an `<app>-oidc-signin` journey that needs the platform stack through
`--accounts`. Run one identity per isolated profile, and run sign-out journeys last.
