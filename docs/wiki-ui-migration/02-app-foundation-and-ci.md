# Unit 02 — Wiki WIP 基準化・App foundation・CI

## Context

全体計画は [`index.md`](index.md)。library defect は
[`01-shared-library-defects.md`](01-shared-library-defects.md) が所有する。この unit は Unit 01 の完了後に
実行し、Unit 03〜07 が同じ theme、CSS、public API、静的検査、clean E2E 基盤から作業できる状態を作る。

この unit は画面の見た目を一括移行する段階ではない。既存 WIP を失わずに基準化し、app integration の
所有境界と CI の再現性を確定する。後続画面の JSX は、foundation を成立させるために必要な public API
不整合の修正だけを対象とし、shell/public、Wiki/editor、ingestion/sources、tasks/admin/settings の本移行は
それぞれ Unit 03〜06 に残す。

主な対象:

- `wiki/app/root.tsx`, `wiki/app/app.css`, `wiki/package.json`, `wiki/vite.config.ts`
- `wiki/tests/architecture/**`, `wiki/tests/e2e/global-setup.ts`, `wiki/playwright.config.ts`
- `scripts/check-ui-conventions.mjs`, `scripts/run-ci.mjs` と `.github/scripts/*test.mjs`
- `.github/scripts/changed-workspaces.mjs`, `.github/workflows/ci.yml`, `.github/workflows/deploy.yml`
- 必要な場合だけ、foundation の型解決を妨げる Wiki consumer

### 2026-09-13 時点の確認済み baseline

計画作成時点では、以前の「Wiki typecheck は 9 エラー」という記述は既に古い。実行結果は次のとおり。
実装開始時には同じ検査を再実行し、以下を固定値として信用しない。

- `rtk pnpm -C wiki typecheck` は成功する。
- `rtk node scripts/check-ui-conventions.mjs --app wiki` は exit 0 だが、約100件の
  `literal-color` allowance を出す。
- checker は現在 `.tsx` と `.css` しか走査しないため、`.ts`、`.js`、`.jsx` にある direct UI import を
  見落とせる。
- `literal-color` は class の任意値 `[...]` を一律に色として扱うため、attribute selector、grid、calc 等の
  layout 表現まで色違反として誤分類する。
- `--staged` は path の選択だけ Git index を使い、本文、`package.json`、`app.css`、legacy directory の存在は
  working tree から読む。部分 stage や staged deletion を正しく検査できない。
- `wiki/app/root.tsx` は shared CSS、`ThemeProvider`、`Toaster` を導入済みだが、通常 document と
  `ErrorBoundary` の document shell が重複し、error document が同じ theme provider 契約を通らない。
- `wiki/app/app.css` の layer order と shared CSS import は正しい。残存 CSS が Wiki 固有 bridge か、共有
  component の再実装かの分類は未完了。
- `.github/scripts/changed-workspaces.mjs` は Wiki を `e2e: false` としており、hosted E2E matrix に入れない。
- `wiki/tests/e2e/global-setup.ts` は `.wrangler/state/v3` 内の hash 名 SQLite を探索し、手元
  `.dev.vars` を読む。fresh checkout では D1 の生成順とローカル state に依存する。
- typecheck/test/build/deploy の hosted job は shared UI を先に build する WIP を含む。順序の重複や欠落を
  workflow test で確定していない。

## External Goals

- 現在の staged、unstaged、untracked WIP を失わず、開始時と完了時の差分を path 単位で照合できる。
- Unit 01 で確定した操作、theme、icon、feedback contract を Wiki が package root と公開 CSS export だけから
  利用できる。
- shared CSS と ThemeProvider が SSR、hydration、reload、portal、Light/Dark/system、error document で
  一貫する。
- clean checkout の typecheck/test/build/E2E/deploy job が、既存 `design-system/dist`、手元 `.wrangler` state、実
  Accounts、実 secret に依存しない。
- convention checker が Git index と working tree を混同せず、真の色違反、任意 layout、正当な native
  control、shared component misuse を別々に扱う。
- 後続 unit の未移行箇所は可視化された縮小専用 baseline に閉じ込め、新しい legacy usage を追加できない。
- Wiki の変更が hosted E2E と local `ci:full` の対象になり、実際にテストが走ったことを log と test で確認できる。

## Scope and ownership

### この unit が所有するもの

- document root、theme provider、global Toaster、shared stylesheet import と Wiki 固有 CSS の責務境界
- Wiki consumer の public import/type resolution の基準
- convention checker の source/index reader、rule 分類、temporary migration baseline
- Wiki E2E の test-only env、D1 migration/seed、session storage state、Playwright 起動順
- changed-workspace、local CI、hosted CI/deploy における UI build と Wiki E2E の選択・順序
- 上記契約を固定する architecture/unit/workflow tests

### 後続 unit に残すもの

- shell/public 画面の composition と visual QA: Unit 03
- Wiki page/editor/share の画面移行: Unit 04
- ingestion/source/notification の画面移行: Unit 05
- task/admin/settings の画面移行: Unit 06
- 全 source の temporary baseline 解消、不要 dependency 削除、全画面 browser matrix: Unit 07

`app.css`、root、global E2E fixture、workflow、temporary baseline はこの unit の競合点とし、Unit 03〜06 から
編集しない。新しい shared library gap が出た場合は Wiki-local wrapper を作らず、Unit 01 と同じ defect report
形式で独立 `design-system/` task に戻す。

## Acceptance criteria

- [ ] 開始時の `HEAD`、status、cached diff、working-tree diff、untracked list を別々に記録し、各 path の所有
      unit を決めてから編集する。
- [ ] Unit 01 の defect report が全件解消済みで、UI typecheck/unit/build/consumer/focused E2E が成功する。
- [ ] Wiki の typecheck が clean UI build 後に成功し、foundation 修正で新しい consumer type error がない。
- [ ] `ThemeProvider` の JSX 定義箇所は root の共通 document shell 一箇所で、各 document render に provider が
      一つだけ存在する。
- [ ] `defaultTheme="system"` と `storageKey="gdg-apps-theme"` を一箇所で固定し、通常画面と error document が
      同じ `<html lang>`, CSS, theme bootstrap を使う。
- [ ] `app.css` の最初の非 comment 行が layer declaration で、Tailwind/shared CSS/font の import は一度だけ、
      Wiki 固有 selector は所有理由を説明できる。
- [ ] foundation-owned source は direct legacy UI import、literal theme color、undocumented shared props、local
      primitive 再実装を含まない。
- [ ] `check-ui-conventions --staged` は source、manifest、stylesheet、directory existence をすべて Git index
      snapshot から読み、working tree の内容で結果が変わらない。
- [ ] checker の full scan は `.ts`, `.tsx`, `.js`, `.jsx`, `.css` を対象とし、色と任意 layout を混同しない。
- [ ] allowance は既知 rule id、具体的 rationale、一件の対応 violation を持ち、typo、空理由、stale allowance を
      fail する。
- [ ] 後続 unit 所有の既存違反は source inline allowance ではなく、path/rule/normalized fingerprint/件数を持つ
      縮小専用 baseline として固定され、置換、増加、別 path への移動を fail する。
- [ ] Wiki changed-workspace は `ci`, `build`, `e2e` にそれぞれ一度だけ入り、UI-only change は Wiki E2E を
      不要に起動しない。
- [ ] fresh な専用 local persistence path へ全 migration と deterministic seed を適用し、admin/author/member と
      基準 page の署名済み storage state を生成できる。
- [ ] E2E は実 Accounts、production/remote D1、既存 `.wrangler/state`、developer の `.dev.vars` に依存しない。
- [ ] CI が test-only Wiki vars を生成し、UI build → Wiki state prepare → Playwright の順で実行する。
- [ ] `.dev.vars`、storage state、専用 D1 state、`design-system/dist`、Worker types、Playwright output を commit しない。
- [ ] final diff audit で開始時 WIP と unrelated change が保全され、Unit 02 所有外の画面差分がない。

## Detailed implementation plan

### Phase 0 — Entry gate と WIP inventory

1. 次を別々に採取する。出力を一つの `git diff` に畳まず、index と working tree の二層を保持する。
   - `rtk git rev-parse HEAD`
   - `rtk git status --short`
   - `rtk git diff --cached --name-status`
   - `rtk git diff --name-status`
   - `rtk git ls-files --others --exclude-standard`
2. Unit 02 の対象 path を「既存 WIP を採用」「Unit 01 の public contract に合わせて修正」「この unit で新規」
   「Unit 03〜07 に保留」「unrelated」の五区分にする。
3. `reset`、`checkout`、一括 formatter、schema dump、Worker type generation の差分で既存 WIP を上書きしない。
   typecheck が `worker-configuration.d.ts` を生成しても tracked diff に含めない。
4. Unit 01 の public export と実装を再確認する。最低限、ThemeProvider、Toaster、Button、IconButton、
   AlertDialog、DropdownMenu checkbox/radio、Select、FormField、Icons、Combobox、DatePicker の package-root export、
   exact props、ref/event forwarding、Storybook state を照合する。
5. reference と source が食い違う場合は source を優先し、app 修正を始めず defect report を追加する。Unit 01 が
   未完了なら、この unit の app workaround で先へ進まない。

Phase 0 の成果物は handoff 記録であり、repository に一時 inventory file を追加しない。

### Phase 1 — Wiki consumer contract の基準化

1. `wiki/package.json` の `@gdgjp/design-system: workspace:*` を維持し、app source が `@gdgjp/design-system` package root と
   `@gdgjp/design-system/{tailwind,components,fonts}.css` だけを利用することを確認する。`design-system/src/**` や private CSS class への
   import は禁止する。
2. foundation を妨げる型不整合だけを最小修正する。修正規則は次で固定する。
   - Button/IconButton の size は `sm | md | lg`。`default`、`xs`、pixel size alias を app 判断で足さない。
   - submit action は `type="submit"` を consumer が明示する。共有 Button の既定 `type="button"` を変えない。
   - AlertDialog の Cancel/Action は `asChild` で Button を合成し、Radix close と focus restoration を保持する。
   - SelectTrigger に undocumented `size` を渡さず、native/Radix props と public `className` だけを使う。
   - DropdownMenuCheckboxItem/RadioItem は package root export を使い、選択 indicator を手書きしない。
   - FormField は label/description/error/required/disabled/id を所有し、name/validation/submit は app に残す。
   - Icons に存在する semantic name を使い、意味の異なる近似 icon や direct `lucide-react` import へ逃げない。
3. ShareDialog、task date field 等の domain controller はこの phase で全面移行しない。Unit 01 の Combobox/
   DatePicker 型を Wiki から import できることだけ compile probe で確認し、接続は所有 unit に残す。
4. consumer 修正で loader/action、form field name、intent、fetcher state、route URL、ACL、copy、locale text を
   変更していないことを diff で確認する。

### Phase 2 — 共通 document shell、theme、global feedback

`wiki/app/root.tsx` を通常画面と ErrorBoundary が共有する document shell に整理する。

1. `<html>`, `<head>`, viewport、Meta、Links、body class、ThemeProvider、Scripts を一つの local
   `Document` composition に集約する。React Router 固有 document composition なので `design-system/` へ移さない。
2. ThemeProvider は共通 shell 内の一箇所だけに置き、`storageKey="gdg-apps-theme"`,
   `defaultTheme="system"` を明示する。Wiki に CSP nonce が導入されていない現状では架空の nonce を作らない。
   将来 CSP が導入された場合は request nonce を loader から provider へ渡すことを contract として comment/test
   に残す。
3. 通常 app は provider 内に FirebaseConfigContext、Outlet、Toaster を置く。Toaster は一つだけ、portal が
   document theme を継承し、既存 position/richColors と通知 contract を維持する。
4. ErrorBoundary も同じ document/theme/CSS shell を通す。404/500 の content redesign は Unit 03 に残し、
   status、文言、home link、metadata を変えない。loader data を利用できない error path でも deterministic な
   language fallback を持ち、hydration markup を変えない。
5. ScrollRestoration と analytics script の位置・回数を監査する。通常 navigation contract を維持し、error
   document に不要な loader-dependent provider を持ち込まない。
6. root 内の重複 `@gdgjp/design-system` import を統合し、shared component の内側 DOM や class を selector/test contract に
   しない。

追加・更新する test:

- root source/SSR test: provider 一箇所、storage key/default theme、通常/error document の共通 shell。
- ErrorBoundary test: 404/500 の status/text/home action を保持し、theme hook が provider 外にならない。
- Playwright foundation smoke: mount 前後で theme-dependent branch が変わらず、Toaster が provider 内で
  resolved theme を継承し、console hydration error がない。

### Phase 3 — CSS layer と app-local bridge の責務固定

`wiki/app/app.css` は次の順序を exact contract とする。

1. 最初の非 comment 行に
   `@layer theme, base, gdg-tokens, gdg-base, gdg-components, utilities;`。
2. 直後に Tailwind、`@gdgjp/design-system/tailwind.css`、`components.css`、`fonts.css` を一度ずつ import。
3. `@source "../../gdg-lib/src/ui"` は account menu/app launcher の consumer utility scan として保持する。
4. 残してよい app-local CSS を次に限定する。
   - CodeMirror/Yjs collaboration cursor と remote user color bridge
   - TipTap/Markdown/md-editor-rt の third-party DOM bridge
   - page-local reader preference (`data-small-text` 等)
   - 外部 widget が公開 hook を持たない場合の semantic-token bridge
5. shared Button/Input/Card/Dialog/Menu/Toast/theme token/motion/elevation を再現する selector、literal theme color、
   `.dark` 内の重複汎用 token を削除する。third-party selector 内でも色は `--gdg-*` semantic token を使う。
6. dynamic user/API color は `design-token-policy: allow-dynamic-color` の既存 narrow pragma と、色以外の
   label/shape indicator を同時に保持する。static color を dynamic exception に偽装しない。
7. `border-radius: 6px` 等の Wiki 固有 finite radius は shared radius token に寄せられるかを分類する。
   third-party DOM の互換上残す必要がある場合だけ、対象 selector と理由を限定する。

`wiki/tests/architecture/theme-tokens.test.ts` を拡張し、layer/import の存在だけでなく順序・重複なし、禁止 token
定義なし、許可された selector family だけが app.css に残ることを検査する。warning card 等の画面固有 assertion
は所有 route の test に移し、foundation test と混在させない。

### Phase 4 — `check-ui-conventions` を snapshot-correct にする

`scripts/check-ui-conventions.mjs` を「source の取得」と「rule evaluation」に分離し、CLI import 時に実行しない
構造へ変える。`.github/scripts/check-ui-conventions.test.mjs` から pure rule と temporary Git repository を使う
integration path を検査する。

#### Source reader

- full mode は filesystem から `.ts`, `.tsx`, `.js`, `.jsx`, `.css` を走査する。generated output、test result、
  `node_modules` は app source root 外なので対象にしない。
- staged mode は `git diff --cached --name-only -z --no-renames` で対象 path を選び、本文は
  `git show :<path>` または同等の index blob reader から読む。
- staged deletion は検査本文から除外するが、legacy directory/package/app.css の存在判定は
  `git ls-files --cached` と index blob で行う。
- partially staged file、index-only file、staged deletion 後に同名 file を working tree へ再作成した場合も、
  working tree を一切参照せず同じ結果にする。
- staged app source が一件でもある場合、`<app>/package.json` と `<app>/app/app.css` の index blob、legacy
  directory の index tree を必ず foundation check に含める。
- missing blob、invalid JSON、Git command failure は pass にせず、path と原因を一つの deterministic error にする。

#### Rule model

- `legacy-import`: listed UI dependency の static/dynamic import を全 JS/TS extension で検出する。type-only import も
  同じ direct dependency なので除外しない。
- `semantic-color`: `text-black`, `bg-white`, `border-foreground` 等の literal/non-semantic utility を検出する。
- `literal-color`: JSX class/style 内と CSS declaration 内の hex/rgb/hsl/color literal、および Tailwind の color
  arbitrary value だけを検出する。`[&_*]`, `grid-cols-[...]`, `max-w-[...]`, `calc(...)` 等を色 violation にしない。
- layout arbitrary value を検査する必要がある場合は別 rule id (`arbitrary-layout`) とし、semantic color と別の
  message/rationale を持たせる。CSS selector 用 bracket と class value を区別する。
- `stack-align`, `button-full-width`, `form-field-hide-label` は multiline JSX、namespace member、expression
  className の既存 contract を回帰 test で固定する。regex が安全に扱えない構文を silent pass にせず、必要なら
  TypeScript parser を導入する独立判断点にする。
- foundation rule として `design-system/src/**` import、重複 ThemeProvider、legacy component directory、app.css layer/import
  順を検査する。

#### Allowance と migration baseline

- inline pragma は `gdg-ui-allow: <known-rule-id> — <specific rationale>` のみ受理する。
- unknown rule、空/placeholder 理由、同じ pragma に複数 rule、次の対象に violation がない stale pragma、広い
  file/directory suppression は error にする。
- layout の誤検出として置かれた既存 `literal-color` allowance は、rule 修正後に全件再評価して不要なら削除する。
- 後続画面に残る真の violation は inline allowance を量産せず、例えば
  `wiki/tests/architecture/ui-conventions-baseline.json` に `ruleId`, repository-relative `path`, normalized
  `fingerprint`, `count` を固定する。fingerprint は import specifier、literal token、component/prop pattern 等の
  violation identity だけから作り、whitespace や line number を含めない。
- baseline は fingerprint ごとの置換・増加、新しい path、新しい rule を fail し、減少は許可するが stale entry の
  更新を促す。単純な path/rule 合計だけで、既存一件を別の新規違反へ入れ替えられる設計にしない。
- `wiki/app/root.tsx`, `wiki/app/app.css`, `wiki/package.json` と Unit 02 で新規作成する source は baseline 対象外で
  fail closed にする。
- Unit 07 は baseline entry をゼロにして file と baseline option 自体を削除する。temporary baseline を恒久的
  allowlist にしない。

最低限の checker tests:

- full scan の全 extension、package dependency、legacy directory、CSS order
- staged clean/violation、partially staged、index-only、staged deletion、same-name working-tree recreation
- deleted `app.css`/`package.json` と invalid manifest
- 各 rule の positive/negative、literal color と arbitrary layout の境界
- valid allowance、unknown rule、missing rationale、stale allowance
- baseline exact match、増加、新規 path、減少、stale entry、foundation path への baseline 禁止
- CLI exit code、stdout/stderr、複数 app 指定

### Phase 5 — architecture guardrail を app 内に固定

checker だけに依存せず、`wiki/tests/architecture/` へ app contract を追加する。

- `theme-tokens.test.ts`: layer/import order、single provider、storage key、legacy theme bootstrap 不在、app.css scope。
- 新規 `ui-foundation.test.ts` または既存 architecture test: `app/components/ui/` 不在、package-root import、
  foundation path の direct legacy import なし、temporary baseline schema と shrink-only contract。
- scan は hidden/file/color input、contenteditable、third-party editor internals等の正当な native semanticsを、共有
  primitive mimic と区別する。native element 件数をゼロにする test は書かない。
- test は source class 名や Radix の内部 DOM ではなく、公開 import、document structure、role/name/state contract
  を基準にする。

`scripts/check-ui-conventions.mjs` の変更だけでも script tests が走るよう、
`.github/scripts/changed-workspaces.mjs` の `scriptTests` predicate と `scripts/run-ci.mjs` の changed-step selection を
更新する。test file だけ変更した場合にしか checker test が走らない状態を残さない。

### Phase 6 — fresh Wiki E2E state を決定的に作る

現状の「最新 mtime の SQLite file を探して直接開く」方式を廃止し、Wrangler/Miniflare が共有する明示的な
test persistence path を使う。

1. `wiki/vite.config.ts` は通常開発では既定 `.wrangler/state` を維持し、
   `WIKI_E2E_PERSIST_TO=.wrangler/e2e-state` がある場合だけ
   `cloudflare({ persistState: { path: ".wrangler/e2e-state" } })` を使う。値は Wiki directory 配下のこの
   test-only path に限定し、workspace 外や通常 local DB を指す値を拒否する。
2. D1 migration/seed を行う helper は同じ path を Wrangler `--persist-to` に渡す。hashed SQLite filename を
   探したり直接開いたりせず、`wrangler d1 migrations apply ... --local --persist-to ...` と
   `wrangler d1 execute ... --local --persist-to ... --file <seed>` を使う。
3. seed SQL は repository に置く deterministic fixture とし、固定 ID の admin/author/member、restricted 基準
   page、必要な関連 row を idempotent upsert する。`page_access` 等、suite が変更する row は開始時に固定状態へ
   reset する。production data や通常 local data を削除しない。
4. session cookie signing は app の cookie contract (`version`, cookie name, issuer, subject, expiry, HMAC format) と
   同じ test helper で行う。secret と issuer は `WIKI_E2E_SESSION_SECRET` と `WIKI_E2E_ISSUER` から受け、
   developer の実 secret を log しない。
5. CI は `wiki/.dev.vars` に test-only RP secret、client secret、localhost APP/ACCOUNTS/IDP URL、
   `ENVIRONMENT=development` を生成し、global setup に同じ non-production secret/issuer を渡す。optional external
   integrations は空または test-safe value とし、remote call を必要としない。
6. storage state は admin/author/member ごとに固定名で生成し、gitignored directory に置く。cookie の domain、
   path、secure、sameSite は localhost HTTP の app contract と一致させる。
7. setup は migration → seed → row count/invariant check → storage state の順で fail closed にする。失敗時は secret
   や cookie 本文を出さず、phase と command/path だけを報告する。
8. cleanup は明示的な E2E persistence/storage-state path だけを対象とし、通常 `.wrangler/state` や workspace root
   を再帰削除しない。CI job の隔離を基本とし、local retry は idempotent seed で成立させる。

`wiki/playwright.config.ts` は E2E persistence env を webServer と global setup の両方へ渡す。専用 state と
異なる手動 dev server を誤利用しないよう `reuseExistingServer: false` を CI/local とも固定し、port 使用中は
明示的に fail する。`fullyParallel: true` と CI worker 1 の既存意図は維持し、fixture mutation が競合する spec は
serial scope または per-test ID で隔離する。

E2E setup の test:

- pure unit: cookie payload/signature、env validation、persistence path validation、seed fixture ID。
- integration: 空の専用 persistence directory から migration/seed を実行し、3 users、基準 page、初期 ACL を
  Wrangler query で確認する。
- smoke: anonymous public route、author storage state で基準 page、admin state で admin route を開く。
- retry: 同じ setup を二回実行して row 重複・ACL leakage・migration error がない。
- negative: secret/issuer 不足、不正な persistence path、migration/seed failure が明示的に fail する。

### Phase 7 — local/hosted CI と deploy 順序を確定

#### Changed workspace

- `.github/scripts/changed-workspaces.mjs` の Wiki entry を `e2e: true` にする。
- Wiki app/test/config/migration change は `ci: [@gdgjp/wiki]`, `build: [@gdgjp/wiki]`, `e2e: [wiki]` を返す。
- `design-system/` change は UI 自身の consumer/E2E を走らせる既存 contract を維持し、全 app E2E へ fan-out しない。
- global config/workflow detector の `--all` と fallback behavior は既存全 target contract を維持する。
- checker source/baseline/workflow test の変更は `scriptTests: true` になる。

#### Local CI

- `scripts/run-ci.mjs` の `ci:full` hard-coded E2E list に `@gdgjp/wiki` を一度だけ追加する。
- changed full path は Wiki `app/**`、E2E spec、setup/config の変更で Wiki Playwright を選ぶ。
- quick path は UI build dependencyを Turboの `dependsOn: ["^build"]` で満たし、full pathでもPlaywright前に
  `@gdgjp/design-system` buildが完了することをtestで固定する。
- checker source変更時は corresponding script testを走らせ、app source変更時は staged checkerを走らせる。

#### Hosted CI

- typecheck/test/build/E2E の各 clean job で、consumer より前に `pnpm --filter @gdgjp/design-system build` を一度だけ行う。
- UI job 自身は build 後に `test:consumer` を実行し、app build と名称を混同しない。
- E2E matrix の Wiki branchだけ `wiki/.dev.vars` と E2E envを作る。既存 Accounts migration condition から Wiki
  を明示的に除外し、他appの既存Accounts依存は維持する。forged local Wiki sessionのために実Accounts
  server/databaseを起動しない。
- Wiki E2E preparationをPlaywright起動前に行い、fresh state smokeが実行されたことをlogで確認する。
- Wiki除外を説明する古い workflow commentを削除し、temporary skip/`continue-on-error`を追加しない。
- Playwright reportは失敗時もuploadし、`.wrangler` state、`.dev.vars`、storage stateはartifactへ含めない。

#### Deploy

- `.github/workflows/deploy.yml` の clean deploy jobがWiki build前にUIをbuildすることをworkflow testで固定する。
- deployではtest-only env、local migration、E2E seedを一切使わない。既存のremote migration/deploy順とsecret
  boundaryを変えない。

`.github/scripts/changed-workspaces.test.mjs` と `.github/scripts/gdg-ui-ci.test.mjs` を更新し、文字列の存在だけ
でなくtarget selection、回数、条件、順序を検査する。workflow test は root `devDependencies` に明示した
`yaml` で YAML を構造化して読み、comment 内の文字列で false pass しないようにする。この追加が必要な場合だけ
root `package.json` と `pnpm-lock.yaml` を更新する。

### Phase 8 — 段階検証と final audit

実装は次の順で小さく検証する。

1. checker pure/unit tests と temporary Git repository integration tests。
2. Wiki architecture tests。
3. root/theme focused tests と Wiki typecheck。
4. E2E setup pure/integration tests。
5. fresh state の Wiki Playwright smoke、続いて既存 Wiki E2E 全体。
6. changed-workspace/run-ci/workflow tests。
7. UI build/consumer checks、Wiki test/build、repository quick gate。
8. staged snapshot を作る場合は `--staged` checker の adversarial cases を実 index でも再確認する。

最後に開始時 inventory と `git status`/cached/working-tree/untracked を突き合わせる。formatter による所有外
画面の churn、lockfile の不要更新、schema dump、Worker types、dist、test output、local DB、developer secret が
ないことを確認する。Unit 02 の completion だけを `status.md` に反映し、後続 unit を完了扱いにしない。

## File-by-file change map

| path | planned responsibility | must preserve |
| --- | --- | --- |
| `wiki/app/root.tsx` | shared Document、single ThemeProvider、Toaster/error shell | locale、metadata、analytics、Firebase config、revalidation |
| `wiki/app/app.css` | layer/import order、Wiki/third-party bridge only | editor/collaboration/reader behavior、semantic tokens |
| `wiki/package.json` | E2E prepare/test command と必要 dependency contract | production scripts、unrelated test dependencies |
| `wiki/vite.config.ts` | scoped E2E `persistState` | normal dev port、DO/workflow names、remote binding behavior |
| `wiki/playwright.config.ts` | state/env/webServer sequencing | CI retry/worker policy、baseURL |
| `wiki/tests/e2e/global-setup.ts` | migrate/seed/session state orchestration | auth payload/cookie contract、role fixtures |
| `wiki/tests/e2e/setup.ts`（新規候補） | path/env検証、Wrangler prepare、cookie helper | secret非出力、global setupから再利用 |
| `wiki/tests/e2e/seed.sql`（新規候補） | idempotent fixed fixture | current schema、no production identifiers |
| `wiki/tests/unit/e2e-setup.test.ts`（新規候補） | setup pure unit/negative cases | 実remote resourceへ接続しない |
| `wiki/tests/architecture/theme-tokens.test.ts` | theme/CSS architecture | route-specific assertionsは所有testへ移す |
| `wiki/tests/architecture/ui-foundation.test.ts`（新規候補） | imports/legacy/baseline contract | native domain UI exceptions |
| `wiki/tests/architecture/ui-conventions-baseline.json`（一時） | shrink-only legacy debt | Unit 07で削除 |
| `scripts/check-ui-conventions.mjs` | full/index readers、rules、allowance/baseline | multi-app CLI、deterministic output |
| `.github/scripts/check-ui-conventions.test.mjs`（新規） | checker regression matrix | temp repo isolation |
| `scripts/run-ci.mjs` | Wiki full E2E、checker tests selection | focused staged CI、unrelated workspace isolation |
| `.github/scripts/changed-workspaces.mjs` | Wiki E2E selection、script test trigger | deploy/global propagation semantics |
| `.github/scripts/changed-workspaces.test.mjs` | exact output regression | all existing workspace counts/order |
| `.github/scripts/gdg-ui-ci.test.mjs` | UI build/consumer/Wiki E2E workflow order | clean job isolation |
| `.github/workflows/ci.yml` | Wiki vars/state/E2E enablement | no real secrets/remote DB、report upload |
| `.github/workflows/deploy.yml` | UI-before-consumer assertionのみ必要なら修正 | remote deploy/migration contract |
| `package.json` | workflow test 用 `yaml` の direct devDependency | scripts と unrelated dependency |
| `turbo.json` | dependency orderが不足する場合のみ修正 | cache/output definitions、no duplicate app hooks |
| `pnpm-lock.yaml` | package dependencyが実際に変わる場合だけ更新 | unrelated lockfile entries |

## Protocols

- `@gdgjp/design-system` は package root と公開 CSS export だけを consumer contract とする。`design-system/src/**` import 禁止。
- UI package は routing、auth、network、Wiki schema、i18n resource を import しない。
- route URL、loader/action、form name/intent、ACL、translation、notification、task state を visual foundation のために
  変更しない。
- native props/ref、controlled/uncontrolled state、Radix event、portal、Escape、focus restoration を保持する。
- overlay は title/description を持ち、trigger なし controlled usage は focus return target を所有する。
- Button の default type は `button`。submit は consumer が明示する。
- app-local CSS exception は third-party/domain bridge に限定し、literal static color は認めない。
- checker の false positive は rule を正しく分離して直し、広い suppression で隠さない。
- temporary migration baseline は増加不可・縮小専用で、Unit 07 に deletion gate を持つ。
- E2E fixture は localhost/test ID/test secret のみを使い、remote binding・production dataへwriteしない。
- generated `dist/`、Worker types、Playwright output、`.dev.vars`、storage state、local persistenceはcommitしない。
- failure を `continue-on-error`、suite除外、既存local state、fallback componentで回避しない。

## Validation commands

実装中のfocused checks:

```sh
rtk node --test .github/scripts/check-ui-conventions.test.mjs
rtk node --test .github/scripts/changed-workspaces.test.mjs .github/scripts/gdg-ui-ci.test.mjs
rtk pnpm --filter @gdgjp/wiki exec vitest run \
  tests/architecture/theme-tokens.test.ts \
  tests/architecture/ui-foundation.test.ts \
  tests/unit/e2e-setup.test.ts
rtk pnpm --filter @gdgjp/design-system build
rtk pnpm -C wiki typecheck
rtk pnpm --filter @gdgjp/wiki test
rtk pnpm --filter @gdgjp/wiki build
rtk node scripts/check-ui-conventions.mjs --app wiki
```

fresh E2E checks:

```sh
rtk pnpm --filter @gdgjp/design-system build
rtk pnpm --filter @gdgjp/wiki exec playwright test \
  tests/e2e/access-control.spec.ts \
  tests/e2e/page-menu.spec.ts \
  tests/e2e/sources-theme.spec.ts \
  --reporter=line
rtk pnpm --filter @gdgjp/wiki test:e2e
```

final gates:

```sh
rtk pnpm --filter @gdgjp/design-system typecheck
rtk pnpm --filter @gdgjp/design-system test
rtk pnpm --filter @gdgjp/design-system build
rtk pnpm --filter @gdgjp/design-system test:consumer
rtk pnpm --filter @gdgjp/wiki typecheck
rtk pnpm --filter @gdgjp/wiki test
rtk pnpm --filter @gdgjp/wiki build
rtk pnpm --filter @gdgjp/wiki test:e2e
rtk pnpm ci:quick
rtk node scripts/check-ui-conventions.mjs
rtk node scripts/check-ui-conventions.mjs --app wiki
rtk git diff --check
```

`test:consumer` は必ず UI build 後に行う。UI typecheck が TS5096 wrapper/configuration baseline で失敗する
checkout では、原因を確認した上で `design-system/` から `rtk pnpm exec tsc --noEmit` を追加実行し、wrapper failure と
source error を分けて報告する。Playwright は fresh E2E persistence path を使い、通常の local `.wrangler`
stateやstale serverを再利用しない。

## Browser verification required in this unit

画面本移行は後続 unit だが、foundation に直接関係する最小 browser check は省略しない。

- 通常 document と 404/500 を Light/Dark/system で reloadし、theme flash、hydration warning、provider errorなし。
- shared dialog/menu/toastを一つずつ開き、portalが同じtheme、Escape、focus returnが機能する。
- 390px/1280pxでroot-level horizontal overflowがなく、長い日本語error textがwrapする。
- keyboard入力時のfocus indicatorとpointer入力時のmodality切替がshared ThemeProvider contractどおり。
- console error/page error/network requestにfoundation変更由来の失敗がない。

Unit 03以降の各画面visual differenceや全状態matrixを、この限定確認だけで検証済みとは扱わない。

## Handoff checklist

- changed filesと各fileのintent
- 開始時/完了時のHEAD、staged、unstaged、untracked inventory
- Unit 01 library defect reportの解消状態と、新規defectの有無
- temporary convention baselineのentry数とUnit 03〜06の所有割当
- 実行したcommand、exit/result、失敗を再実行した場合の原因
- fresh D1/stateを使ったことと、remote writeがないこと
- Light/Dark/system、error document、portal、keyboardの確認結果
- intentional visual difference。なければ「なし」と明記
- 未実行・未検証事項と理由
- commitの有無、commit hash、pushの有無

### Library defect report at handoff

新規 defect がなければ空表を提出する。ある場合は Unit 01 と同じ情報を必須とする。

| library file/line | expected behavior | app-side work otherwise required | workaround validity after fix |
| --- | --- | --- | --- |
|  |  |  |  |

未解消 defect が一件でもあれば Unit 02 を完了にせず、Unit 03〜07 の blocker を解除しない。

## Tech Stack

- React 19、React Router v7 SSR、TypeScript ESM
- `@gdgjp/design-system`、Radix、next-themes、Sonner、lucide-animated/library-owned static icons
- Tailwind CSS v4、semantic CSS tokens、stable `gdg-*` CSS
- Cloudflare Workers/Vite plugin、Wrangler local D1、Miniflare persistence
- Vitest、Node test runner、Playwright、axe
- pnpm workspace、Turborepo、GitHub Actions、repository Node.js convention checker
