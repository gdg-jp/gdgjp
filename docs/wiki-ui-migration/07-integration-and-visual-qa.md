# Unit 07 — 全領域統合・残存除去・実ブラウザー QA

## Context

全体計画は [`index.md`](index.md)。次の全 unit 完了後に実行する。

- [`01-shared-library-defects.md`](01-shared-library-defects.md)
- [`02-app-foundation-and-ci.md`](02-app-foundation-and-ci.md)
- [`03-shell-and-public-surfaces.md`](03-shell-and-public-surfaces.md)
- [`04-wiki-pages-and-editor.md`](04-wiki-pages-and-editor.md)
- [`05-ingestion-sources-and-notifications.md`](05-ingestion-sources-and-notifications.md)
- [`06-tasks-admin-and-settings.md`](06-tasks-admin-and-settings.md)

この unit は各領域の局所 test 成功を、Wiki 全体としての全面移行完了へ統合する。`app.css`、shared locale
files、barrel/export、E2E fixture/spec、workflow の競合を解消し、残存 direct dependency・local primitive・
native mimic・例外・visual regression を総点検する。新しい機能や業務仕様は追加しない。

## External Goals

- anonymous/member/author/admin の代表フローが shared UI 上で端から端まで動く。
- Light/Dark/system、mobile/desktop、keyboard/pointer、reduced-motion/forced-colors の主要組合せで、全領域が
  一つの design system として見え、操作できる。
- route、auth/ACL、content、source/ingestion、notification、task/admin/settings の既存契約に regression がない。
- clean local/CI/deploy build が `@gdgjp/ui` artifacts を正しい順序で生成し、全 test を実際に実行する。
- 未コミット WIP 由来の変更を含む最終差分が、不要な削除・生成物・unrelated change を含まない。

受け入れ条件:

- `check-ui-conventions.mjs --app wiki` と Wiki architecture test が rationale なしの違反ゼロで通る。
- legacy UI directory/theme/toast/motion/icon dependency と、shared primitive の hand-written duplicate がない。
- 正当な native control/exception は全件 inventory され、理由と behavioral test を持つ。
- UI/Wiki の typecheck、unit、build、consumer、E2E、lint が clean state から通る。
- screenshot/axe/keyboard/overflow/console review の結果を確認し、intentional diff だけを採用する。

## Design

### Residual audit

source 全体に対して import、component directory、interactive native element、role、class/style、CSS token、
theme provider、portal、icon、motion、allowance pragma を scan する。件数ゼロを機械的目的にせず、各残存を
次へ分類する。

1. shared primitive へ置換すべき再実装
2. product-specific composition として正当
3. hidden/file/color/contenteditable 等 native semantics として正当
4. third-party integration bridge として正当
5. stale/dead code

1 と 5 は解消する。2〜4 は一般 styling/interaction を shared contract に委譲し、必要な狭い rationale と
test を残す。broad directory allowlist は作らない。

### Cross-surface consistency

領域間で primary action、status tone、empty/loading/error、heading、page padding、table overflow、mobile action
parity を比較する。同じ意味の surface が別 variant/用語/interaction になっていれば shared contract へ
揃える。locale は ja/en の同じ key set と既存 supplied copy を維持する。

locale key は ja/en の集合一致だけでなく、route/component/test からの使用箇所と照合する。移行で削除した
local primitive、label、help text だけが参照していた key は両 locale から同じ変更で削除し、動的 key の
prefix は明示 inventory して誤削除を防ぐ。

`app.css` は Unit 02 の責務境界へ最終縮小し、使われない selector/token bridge を削除する。UI package
public change が後続 unit で必要になった場合、source/export/CSS/story/test/docs の同期を再監査する。

### Integrated browser matrix

E2E を無制限な直積にせず、各軸と高リスク interaction が少なくとも一度交差する pairwise matrix を作る。

- identity: anonymous、member、author、admin
- theme: Light、Dark、system
- viewport/input: 1280px desktop pointer、390px mobile/coarse、keyboard-only
- surface: public/shell、Wiki/editor/share、ingestion/sources/notification、tasks/admin/settings
- state: default、loading、empty、validation error、network/browser failure、permission denied、destructive confirm

代表 route は主要 heading、navigation、one critical action、horizontal overflow、console/page error を検査する。
focus/Escape/Arrow interaction は high-risk overlay で明示 test し、screenshot は stable data/time/motion で撮る。

### Final change audit

実装前 inventory と最終 status/diff を比較し、ユーザー WIP が無断で消えていないことを確認する。lockfile、
workflow、test snapshot、UI docs の差分を個別 review し、generated Worker types、dist、Playwright output、
`.dev.vars`、local DB を含めない。

### Final handoff artifact

Units 01〜06 の記録を集約し、changed files、開始前/最終 inventory、library defect report と解消状態、
実行した全 command と exit/result、未実行/未検証項目、触れた各画面の Light/Dark 390px/1280px・keyboard
確認、各 intentional visual difference、画面別 commit を最終 handoff に含める。代表画面の追加 QA だけで
全 touched screen を確認済みと扱わない。

## Protocols

- 全体 [`index.md`](index.md) の ownership、behavior invariant、error contract を優先する。
- cross-unit conflict は片方を丸ごと採用せず、両方の intent と test を保って統合する。
- route URL、API、form intent、ACL、domain state を visual consistency のために変更しない。
- test selector は implementation class や Radix DOM 内部ではなく role/name/state を使う。
- screenshot update は一括 overwrite せず、画面ごとの差分を review する。
- locale は ja/en key set、static/dynamic usage、unused key 削除を同時に検証する。
- axe の既知 brand contrast baseline と新規 violation を分け、新規問題を baseline 扱いしない。
- failure があれば fallback/allowlist で隠さず、所有 unit の contract または shared API を根本修正する。
- CI/deploy は clean checkout で成功することを基準とし、手元の生成済み `ui/dist` に依存しない。

## Tests to add/update

- `wiki/tests/e2e/ui-migration.spec.ts` などに pairwise route/identity/theme/viewport matrix を実装する。
- keyboard suites: shell、page/task menu、Combobox、share/source dialog、admin confirm、focus return。
- visual suites: representative page の Light/Dark、desktop/mobile、long Japanese、loading/error。
- accessibility: axe、heading/landmark、label/description/error、ARIA state、forced-colors、reduced-motion。
- resilience: clipboard/storage/notification/network failure、hydration/console/page error、fresh local D1 setup。
- full commands:
  - `pnpm ci:quick`
  - `pnpm --filter @gdgjp/ui run typecheck`
  - `pnpm --filter @gdgjp/ui test`
  - `pnpm --filter @gdgjp/ui build`
  - `pnpm --filter @gdgjp/ui run test:consumer`
  - `pnpm --filter @gdgjp/ui test:e2e`
  - `node scripts/check-ui-conventions.mjs --app wiki`
  - `pnpm -C wiki typecheck`
  - `pnpm --filter @gdgjp/wiki test`
  - `pnpm --filter @gdgjp/wiki build`
  - `pnpm --filter @gdgjp/wiki test:e2e`
  - `pnpm lint`
- fresh/clean hosted workflow path と changed-workspace script tests を実行し、Wiki E2E が skip されないことを
  log で確認する。
- `pnpm ci:quick` による全 workspace consumer regression を完了条件とし、失敗または未実行は handoff に
  command と理由を明記する。
- final handoff artifact が全画面の個別記録、defect、validation、未検証事項を網羅することを checklist で
  確認する。

## Tech Stack

- 全先行 unit の React 19、React Router、`@gdgjp/ui`、Tailwind v4、Cloudflare/Wrangler stack
- pnpm workspace、Turborepo、GitHub Actions
- Vitest、Storybook、Playwright、axe、visual snapshots
- repository architecture tests と UI convention checker
