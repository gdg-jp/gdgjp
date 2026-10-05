# GDG Japan Go Links extension

Build the unpacked Manifest V3 extension and the managed-distribution ZIP:

```sh
pnpm --filter @gdgjp/go-extension build
```

Load `go-extension/dist/unpacked` from `chrome://extensions` for local acceptance testing. The ZIP
is written to `go-extension/dist/gdg-japan-go-links.zip`. The extension redirects `go/<slug>`,
supports the `go` omnibox keyword, and recognizes exact `go/<slug>` searches on Google, Bing, and
DuckDuckGo. It does not store or transmit browsing history or search terms.
