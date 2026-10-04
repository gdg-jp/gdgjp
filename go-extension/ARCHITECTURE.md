# Go extension architecture

This small Manifest V3 extension keeps platform integration separate from URL rules.

- `src/background.js` is the Chrome adapter: it registers omnibox and navigation listeners,
  excludes subframes and invalid tabs, and applies destinations through `chrome.tabs`.
- `src/redirect.js` owns pure go-link parsing and supported search-engine recognition. It does
  not access Chrome APIs, storage, or the network. Its tests live in `src/redirect.test.js`.
- `src/manifest.json` declares permissions, the module service worker, and static rules.
  `src/rules.json` handles direct `http(s)://go/` navigation through Chrome's declarative API.
- `scripts/build.mjs` owns packaging: it copies runtime modules and declarations, generates
  icons from `tinyurl/public/gdg_logo.png`, and produces the unpacked extension and ZIP.

Dependencies flow from the Chrome adapter to pure URL rules. Keep new platform listeners in
the adapter and parsing rules in the pure module; tests must stay outside the packaged files.
There are no frontend components, domain widgets, pages, or composed shells in this app.

The manifest references `background.js` and `rules.json` at the package root. The service
worker imports `./redirect.js`, which must be packaged alongside it. Preserve those paths and
the output names `dist/unpacked` and `dist/gdg-japan-go-links.zip` when changing packaging.
