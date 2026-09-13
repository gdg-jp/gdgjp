# Unit 02 — Wiki WIP 基準化・App foundation・CI

## Context

全体計画は [`index.md`](index.md)。library defect は
[`01-shared-library-defects.md`](01-shared-library-defects.md) が所有する。この unit はその完了後に実行し、
app 全領域移行の foundation を確定する。
ユーザーの未コミット WIP は theme/CSS、ローカル primitive 削除、shared import、CI build 順序まで
広範囲に及ぶ一方、Wiki typecheck は 9 エラー、UI convention check は多数の未解消箇所を報告する。

後続 unit が Wiki 内で別々の substitute component を作らないよう、ここで WIP の保全境界、
修正済み `@gdgjp/ui` API の利用基準、theme/build/CI、静的 guardrail を確定する。

依存: Unit 01。Unit 03〜07 はこの unit の app integration contract と clean CI harness に依存する。

主な対象:

- `wiki/app/root.tsx`, `wiki/app/app.css`, `wiki/package.json`
- `wiki/tests/architecture/**`, `wiki/tests/e2e/global-setup.ts`, `wiki/playwright.config.ts`
- `scripts/check-ui-conventions.mjs` と script tests
- Turbo、changed-workspaces、CI/deploy workflow と workflow tests

後続領域の画面 JSX は、現在の型エラーの最小修正を除き、この unit で一括移行しない。

## External Goals

- 現在の未コミット変更を失わず、後続実装者がどこから続けるかを再現できる。
- Unit 01 で確定した操作・theme・icon・feedback 契約を Wiki が public API だけから利用できる。
- shared CSS と ThemeProvider が SSR、reload、portal、Light/Dark/system で一貫する。
- clean checkout の typecheck/test/build/E2E が既存 `ui/dist` や手元の `.wrangler` state に依存しない。
- foundation 完了時点で Wiki typecheck、UI package checks、既存 Wiki test が実行可能な基準へ戻る。
- convention checker は真の違反と正当な layout/native 例外を区別し、移行後の逆戻りを防げる。

受け入れ条件:

- staged、unstaged、untracked の union と、index/working-tree 二段差分を記録・照合してから編集する。
- WIP にある 9 件の TypeScript error を public contract に沿って解消する。
- Unit 01 の `@gdgjp/ui` build/consumer checks が通った artifact を clean app job が利用する。
- `ThemeProvider` は Wiki root の一箇所、shared CSS layer order も一箇所に固定される。
- Wiki changed-workspace が E2E 対象となり、fresh local D1 の migration/seed と test-only env が CI で
  決定的に準備される。
- `check-ui-conventions` 自体の unit test が full/staged/deleted/allowance/false-positive を覆う。

## Design

### WIP inventory

開始時に `git status --short`、`git diff --name-status`、`git diff --cached --name-status`、untracked list を
別々に取得する。各 path を採用・共有契約へ昇格・consumer 修正・後続 unit 所有に分類する。既存変更を
reset、checkout、再生成物で上書きしない。特に `app.css`、root、削除済み primitive、workflow 差分を
保持する。

### Shared public API の app 側採用

既存 component の composition で解く。新しい library gap が見つかったら app workaround を作らず、
Unit 01 と同じ defect report 契約で別 library task として解消する。Wiki の route、fetcher、ACL、翻訳、
候補モデルを shared package に持ち込まない。

WIP で判明している contract gap を次の観点で解消する。

- AlertDialog action/cancel は現 public contract どおり `asChild` で Button を composition し、destructive/
  neutral の見た目と Radix の close/focus behavior を両立する。Action 自体に Button props を渡さない。
- Button/IconButton は `sm|md|lg`、SelectTrigger は公開 native/Radix props に合わせ、`default`/`xs` や
  undocumented `size` を consumer 側で直す。互換 alias を app 判断で shared API に追加しない。
- DropdownMenu checkbox/radio は package root から正しく import/composition できる。
- form/date field は label/description/error/required/disabled と submit contract を壊さない。
- icon は `Icons` または shared component 内の icon slot で提供し、consumer の `lucide-react` 直接依存を
  終了できる。

### Async/multi-select Combobox の接続準備

Unit 01 が提供する次の public contract を source で再確認する。

- query と open state の controlled/uncontrolled 利用
- consumer が server/async filtering を所有し、shared 側の client filtering を無効化できるモード
- selection 後に close する既定と、複数選択を継続する close policy
- active option、stable option id、`aria-activedescendant`
- ArrowUp/ArrowDown の端停止、Home/End、Enter/Escape、pointer hover と keyboard active state の同期
- async response/filter/chip 追加で active option が消えた場合の clear/reselection policy
- loading/empty/listbox composition。候補取得、ACL、chip state は consumer 所有

ShareDialog をこの unit で全面移行はしない。Unit 04 が domain controller を接続できるよう、package
artifact と type resolution を確認する。

### Theme and CSS

- `@layer theme, base, gdg-tokens, gdg-base, gdg-components, utilities` の後に Tailwind と shared CSS を
  正規順序で読む。
- `app.css` に残すのは TipTap/Markdown、collaboration cursor、reader preference、外部 widget の
  semantic-token bridge だけ。汎用 token/component/motion を複製しない。
- root の ThemeProvider/Toaster は SSR deterministic で、ErrorBoundary も同じ CSS contract を使う。
- dynamic domain color は既存の narrow pragma と non-color indicator を保つ。

### Guardrail and clean CI

checker は direct UI dependency、literal theme color、shared component misuse を検出する。任意値 layout と
色 literal の判定を分け、false positive 解消のためにルール全体を弱めない。例外は rule id と具体的
rationale が必要で、stale 例外を検出する。

`--staged` は cached path だけでなく、対象本文、package manifest、app.css、legacy directory の有無を
Git index snapshot から読む。working tree の未 stage 修正で staged 違反を隠せないようにし、partially
staged file、staged deletion 後に同名 file を再作成した場合、index にだけ存在する file を扱う。

この unit では既存 direct import/native mimic の全残存を report-only inventory として固定する。後続画面が
未移行のままなので、ここで全体ゼロ gate を有効にしない。checker 自体と foundation-owned paths は fail
closed にし、全 source の違反ゼロ enforcement は Unit 07 で有効化する。未移行違反に allowance を付けない。

Wiki E2E は changed-workspace matrix で有効化する。CI は secret ではない test-only `.dev.vars` を生成し、
fresh `.wrangler` state に local migration を適用後、admin/author/member と基準 page を seed して署名済み
storage state を作る。実 Accounts、共有 DB、以前の local state へ依存しない。clean job は consumer の前に
`@gdgjp/ui` を build する。

## Protocols

- `@gdgjp/ui` は package root と公開 CSS export だけを consumer contract とする。`ui/src/**` import 禁止。
- UI package は routing、auth、network、Wiki schema、i18n resource を import しない。
- native props/ref、controlled/uncontrolled state、Radix events、portal、focus restoration を保持する。
- Button の default type は `button`。submit は consumer が明示する。
- overlay は title/description を持ち、trigger なし controlled usage は focus return を指定できる。
- Combobox の single-select 既定挙動を壊さず、async/multi-select は opt-in contract とする。
- CI の test-only env 値は本番 secret と共有せず、`.dev.vars` や storage state を commit しない。
- generated `dist/`、Worker types、Playwright output は commit しない。
- foundation 後の shared API gap は Wiki-local fallback で回避せず、独立 library defect task で解決する。

## Tests to add/update

- Unit 01 の UI typecheck/unit/build/consumer/E2E を app integration 前提として再実行する。
- Wiki architecture: CSS layers、single ThemeProvider、legacy UI directory 不在、app.css responsibility。
  direct import は残存 inventory を出すが、全体ゼロ gate は Unit 07 まで有効化しない。
- checker tests: full scan、Git-index source を読む `--staged`、partially staged file、staged deletion と同名
  working-tree recreation、index-only file、specific allowance、stale allowance、arbitrary layout と literal
  color の区別。
- changed-workspace/workflow tests: Wiki change が E2E matrix に入り、UI build、test env、migration/seed、
  Playwright の順序を固定する。
- fresh temp/local state から Wiki global setup と既存 E2E の最小 smoke を実行する。

## Tech Stack

- React 19、TypeScript ESM
- `@gdgjp/ui`、Radix、next-themes、lucide-animated、stable `gdg-*` CSS
- Tailwind CSS v4、semantic CSS tokens
- Vitest、Storybook、Playwright、axe
- React Router v7、Cloudflare Workers/Vite、Wrangler local D1
- pnpm workspace、Turborepo、GitHub Actions、repository Node.js convention checker
