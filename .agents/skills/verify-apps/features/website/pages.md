# Home, application directory, and policy pages

A visitor reads the landing page, finds a GDG application in the アプリケーション directory, and
moves between the privacy policy and the terms through the header and footer.

## Sub-features

- `website-home`: `/` with h1 **コミュニティの活動を、もっと身近に。**, the lead paragraph
  GDG Japan は、Google 技術を学び、共有し、つながるコミュニティのためのサービスを提供しています。, `<title>`
  `GDG Japan`, meta description GDG Japan のコミュニティ運営を支えるサービスです。, `og:url`
  `https://gdgs.jp/`, and the アプリケーション section with nine links.
- `website-policies`: navigation 主要ナビゲーション (**プライバシー**, **利用規約**), the home link
  **GDG Japan ホーム**, navigation フッターナビゲーション (**ホーム**, **プライバシーポリシー**,
  **利用規約**), `/privacy` (`<title>` `プライバシーポリシー | GDG Japan`) and `/terms`
  (`<title>` `利用規約 | GDG Japan`).

## How to get to it (user POV)

Open `http://localhost:6180/`. Use the header links, the footer links, or the **GDG Japan** wordmark
to move between pages.

## Driving it with Orca Browser

Identity: anonymous, in a fresh isolated profile. No preconditions.

- Home. `goto http://localhost:6180/`. Require level-1 heading
  **コミュニティの活動を、もっと身近に。**, the lead paragraph, level-2 heading **アプリケーション**,
  and `orca eval "document.title"` = `GDG Japan`. Require
  `document.querySelector('meta[name=description]').content` =
  `GDG Japan のコミュニティ運営を支えるサービスです。` and `meta[property="og:url"]` = `https://gdgs.jp/`.
- Directory. In `orca snapshot --interactive`, require links with these names and `href`s:
  **TinyURL** `https://url.gdgs.jp`, **Wiki** `https://wiki.gdgs.jp`, **Scheduler**
  `https://scheduler.gdgs.jp`, **Images** `https://img.gdgs.jp`, **SNS Manager**
  `https://sns.gdgs.jp`, **Connpass** `https://connpass.gdgs.jp`, **Pay** `https://pay.gdgs.jp`,
  **CLI** `https://github.com/gdg-jp/gdgjp#gdg-cli`, **Learn** `https://learn.gdgs.jp`. Do not
  click them. Screenshot.
- Header navigation. Within navigation **主要ナビゲーション** click **プライバシー**. Require URL
  `/privacy`, h1 **プライバシーポリシー**, 最終更新日: 2026年7月28日, the h2 **1. 適用範囲** and
  **6. お問い合わせと改定**, and title `プライバシーポリシー | GDG Japan`. Click **利用規約**; require
  `/terms`, h1 **利用規約**, h2 **1. 適用** and **6. お問い合わせ**, title `利用規約 | GDG Japan`.
  Click **GDG Japan ホーム**; require `/` and the hero heading.
- Footer navigation. On `/terms`, within **フッターナビゲーション** click **プライバシーポリシー**
  (require `/privacy`), then **ホーム** (require `/`). Require the footer text to match
  `© <current year> GDG Japan`.
- Client-side routing. Start `orca capture` before the header clicks; require that moving between
  the three pages does not issue a full document request for each click (React Router data
  requests only), and that no console error is logged (`orca console`).
- Narrow viewport. Resize to 375 px wide if the Orca build supports it; require
  `document.documentElement.scrollWidth <= innerWidth` on all three pages.

Independent check: HTTP `GET /`, `/privacy`, `/terms` each return 200 with the h1 text in the
body (`コミュニティの活動を、もっと身近に。`, `プライバシーポリシー`, `利用規約`), and
`GET /favicon.ico` returns 200.
Evidence: screenshots of the three pages, the directory link list from the snapshot, the
navigation URLs.

## Gotchas

The directory uses `ACCOUNTS_URL` only to choose the site domain; any non-`accounts.*.gdgs.jp` value
(the local `http://localhost:6173`) yields production `gdgs.jp` links by design. Icon images come
from production hosts; a broken icon in an offline run is not a website failure. Unknown paths
are not part of this journey: in Vite dev they render React Router's bare `404 Not Found`
instead of reaching TinyURL (see the [README](README.md)); do not record that as the short-link
behaviour.
