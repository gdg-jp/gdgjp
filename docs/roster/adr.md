# ADR — roster.gdgs.jp

`roster/` を新規ワークスペースとして立ち上げるにあたって下した決定の記録。
実装手順は [index.md](index.md) と `01`〜`09` のステージファイルにある。
ここにあるのは **なぜそうしたか、何を却下したか** である。

リポジトリの ADR 規約は `docs/agents-local-mvp/adr.md` が「既存の ADR 規約が無いためこの 1 ファイルに
連番で記録する」として立てたものに倣う。**決定を消さずに、新しい ADR で supersede すること。**
番号は `roster/` の中で閉じている（`agents-local-mvp` の連番とは独立）。

| # | 決定 | Status |
|---|---|---|
| [001](#adr-001-雛形を-scheduler-ではなく-ost-にする) | 雛形を `ost/` にする | Accepted |
| [002](#adr-002-dev-ポートを-5186-にする) | dev ポートは 5186 | Accepted |
| [003](#adr-003-feature-first-とアーキテクチャテストを初日から入れる) | feature-first + architecture テストを初日から | Accepted |
| [004](#adr-004-ソルバーを-worker-の-action-内で実行する) | ソルバーは Worker の action 内 | Accepted |
| [005](#adr-005-経験レベルを公開ビューに出さない) | 経験レベルは公開ビューに出さない | Accepted |
| [006](#adr-006-履歴を-json-スナップショットで持ち割当テーブルは現在の-1-枚だけにする) | 履歴は JSON スナップショット | Accepted |
| [007](#adr-007-役割マスタをマイグレーションでシードする) | 役割マスタはマイグレーションでシード | Accepted |
| [008](#adr-008-代理登録の本人紐付けを-email-突合で行う) | 代理登録は email 突合 | Accepted |
| [009](#adr-009-prd-とプロトタイプをリポジトリに置かない) | PRD とプロトタイプを置かない | Accepted |
| [010](#adr-010-スコープ外として記録するだけの既存の不整合) | 既存の不整合は記録のみ | Accepted |

---

## ADR-001: 雛形を `scheduler/` ではなく `ost/` にする

### Status
Accepted

### Context

PRD の High-Level Consideration は「ORM なし（tinyurl / scheduler に準拠）」と書いており、
`scheduler/` を雛形として想定していた。`scheduler/` は確かに roster と最も近い形をしている
（D1 + RP 認証 + ORM なし + 時間枠モデル）。

しかし実測すると `scheduler/` の足場は古い。

| | `scheduler/` | `ost/` |
|---|---|---|
| wrangler | `^3.99.0` | `~4.112.0` |
| react-router | `^7.1.1` | `~7.13.2` |
| Vite 統合 | `cloudflareDevProxy` + 独自 `workers/context.ts` | `@cloudflare/vite-plugin` の `cloudflare()` |
| RR future flag | `v8_middleware` | `v8_viteEnvironmentApi` |
| accounts への到達 | 公開 HTTPS | `[[services]] ACCOUNTS` バインディング |
| `[[routes]]` | コメントアウト | 有効 |
| chapter ACL | なし | `app/lib/chapter.server.ts` |

`scheduler/` の `migrations/` は 11 本あり、Better Auth の導入・削除・復活・OIDC への移行という
歴史がそのまま残っている。`ost/` は RP として最初から作られたため `0001_init.sql` 1 本で、
`user` / `oidc_session` の現行スキーマがそのまま入っている。

決定的なのは **chapter ACL** で、`scheduler/` には存在しない（匿名利用が一級市民のアプリなので
必要なかった）。roster は Chapter 所有のイベントを扱うため、`ost/app/lib/chapter.server.ts` の
「`getFreshClaims` → 30 秒キャッシュ → primary / all」パターンがそのまま要る。

### Decision

`ost/` を雛形とする。ただし Durable Object 関連（`[durable_objects]`、`[[migrations]]`、
`esbuild.keepNames`、`/ws` の upgrade 分岐、`run_worker_first`）は roster に不要なので落とす。

データ層のクエリの書き方（`*Row` 型 → `to*()` マッパ → カラムリスト定数 → `RETURNING`）だけは
`scheduler/app/lib/db.ts` のほうが規模の近い実例なので、そちらを参照する。

### Consequences

- `ost/vite.config.ts` の `resolve.dedupe` + `optimizeDeps.include` ブロックは**必ずコピーする**。
  `@gdgjp/gdg-lib` はソースのまま consume されるため、これがないとクライアントに React が 2 つ入り、
  ハイドレーション時に "invalid hook call" で落ちる。原因が分かりにくい種類の事故なので、
  コメントごと持っていく。
- `app/app.css` の `@source "../../gdg-lib/src/ui";` も必須。これがないと gdg-lib の共有 UI に
  Tailwind のクラスが生成されず、スタイルが当たらない。
- `ost/` は shadcn をローカル生成していない（`components.json` を持たない）。roster も同様にし、
  UI プリミティブは `gdg-lib` 由来のものを使う。ダークモードは持たない。

### Rejected

**`scheduler/` を雛形にして wrangler v3 のまま作る。** 新規アプリを既に古い足場の上に建てると、
`ost/` と `scheduler/` の 2 系統だったものが 3 番目にはならないまでも、次のアップグレード対象が
1 つ増える。新規に作るものが最新規約から外れる理由がない。

---

## ADR-002: dev ポートを 5186 にする

### Status
Accepted

### Context

PRD は 5178 を提案していたが、**5178 は `sns/` が使用中**である。

`vite.config.ts` の `server.port` を実測した結果:

| ポート | 使用 |
|---|---|
| 5173 | accounts (`strictPort`) |
| 5174 | tinyurl |
| 5175 | img |
| 5176 | scheduler |
| 5177 | wiki (`strictPort`) |
| 5178 | sns (`strictPort`) |
| 5179 | connpass (`strictPort`) |
| 5180 | **pay (`strictPort`) と website が衝突** |
| 5181 | connpass の e2e モック IdP（dev サーバではないが予約済み） |
| 5182–5184 | 空き |
| 5185 | ost (`strictPort`) |
| 5186 以降 | 空き |

### Decision

**5186**。`strictPort: true` を付ける（accounts / wiki / sns / connpass / pay / ost の慣習）。

5182–5184 も空いているが、5180–5181 周辺は pay / website / connpass-e2e が絡んで既に混乱している
領域なので離れる。`ost` の 5185 の次を取ることで、追加順が番号順に読める状態も保たれる。

### Consequences

ポートの単一の正本は存在しない。**5186 を以下の 6 箇所に手で揃える必要がある。**

1. `roster/vite.config.ts` の `server.port`
2. `roster/playwright.config.ts` の `PORT`
3. `roster/.dev.vars.example` の `APP_URL`
4. `accounts/.dev.vars.example` の `ROSTER_REDIRECT_URLS`
5. `CONTRIBUTING.md` の dev ポート段落
6. `roster/CLAUDE.md` の自己記述（ost / connpass の慣習）

`APP_URL` が dev で `http://localhost:5186` になっていないと、gdg-lib が cookie を Secure 扱いに
して平文 HTTP のサインインが壊れる（`ost/.dev.vars.example` に同じ警告コメントがある）。

---

## ADR-003: feature-first とアーキテクチャテストを初日から入れる

### Status
Accepted

### Context

PRD の想定は `app/lib/solver/` にソルバーを置く `scheduler/` 流の配置だった。これは小さいうちは軽い。

しかし `wiki/` は同じ道を辿った結果、`app/routes/` 130 ファイル・`app/lib/` 98 ファイル、
400 行超のファイル 27 本、feature の置き場が 4 系統に分裂した状態になり、
`docs/wiki-refactoring/` の**全 6 ステージ**を費やして feature-first に再編している。
その再編で最終的に採用された配置ルールと、それを強制する `tests/architecture/` の 9 本が
既に存在する。

roster の規模見積もりは、9 ステージ・12 テーブル・7 画面・ソルバー一式であり、
`scheduler/` より明確に大きく `wiki/` の方向にある。

### Decision

feature-first を初日から採用し、`wiki/tests/architecture/` から 4 本を移植して機械的に強制する。

| テスト | 強制する規約 |
|---|---|
| `layering.test.ts` | `app/lib/` は横断プリミティブのみ / `app/components/` はシェル + `ui/` のみ / `app/features/` は `app/routes/` を import しない |
| `file-size.test.ts` | 非テストソース 1 ファイル 400 行以下 |
| `test-colocation.test.ts` | ユニットテストは被験対象の隣に `<subject>.test.ts` |
| `route-urls.test.ts` | `app/routes.ts` の公開 URL 全集合をスナップショット固定 |

いずれも `fileURLToPath(new URL("../../", import.meta.url))` でワークスペース根を取るだけで
wiki 固有のロジックを持たない。allowlist を空にすればそのまま動く。

### Consequences

- **allowlist は空で始まり、縮小専用。** 追加は許さない。wiki の allowlist が「Stage 06 で意図的に
  分割しなかった 2 本」だけに留まっているのは、追加を禁じているからである。
- `route-urls.test.ts` はルートを足すたびにスナップショットが落ちる。これは**意図した摩擦**で、
  公開 URL が増えたことをレビューで必ず目に入れるためにある。落ちたら意図を確認して更新する。
- `wiki/tests/architecture/design-token-policy.test.ts` は移植しない。roster は `ost/` に倣って
  ダークモードを持たず、デザイントークンの体系を持たないため。将来入れるなら別途。

### Rejected

**ディレクトリだけ feature-first にして、強制はテストではなく `CLAUDE.md` の記述に留める。**
wiki の実績が、記述だけの規約は守られないことを示している。規約を書いたのと同じ人が守るうちは
機能するが、実装エージェントに delegate する運用ではテストだけが効く。

---

## ADR-004: ソルバーを Worker の action 内で実行する

### Status
Accepted

### Context

PRD は「MVP は Worker 内で数秒以内を目標とする。超える場合は Web Worker への移行を検討する」と書き、
未確定のまま残していた。

選択肢は 3 つあった。

1. Worker の action 内（サーバ）
2. ブラウザで実行して結果を POST
3. 両対応

### Decision

**Worker の action 内**。ただしソルバー自体は環境非依存の純 TS として書き、`fetch` も `D1Database` も
`window` も参照しない。

### Consequences

- **履歴の整合性が自然に取れる。** 生成 → `assignments` 書き込み → `revisions` 追記が 1 つの action
  の中で完結する。クライアント実行だと「クライアントが送ってきた割当がハード制約を満たしているか」を
  サーバで再検証する層が別途必要になり、ソルバーのロジックが二重化する。
- **再現性をサーバ側で保証できる。** `events.seed` と D1 の状態から同じ結果が出ることを、
  クライアントの実装差に依存せず言える。
- **Workers の CPU 時間がリスク。** そのため Stage 06 の完了条件に**規模ベンチ（スタッフ 100 名 ×
  時間枠 60 × 役割 10）を必須**として入れる。実測せずに次へ進まない。
- 境界を純関数に保つので、将来クライアント実行へ移す必要が出ても呼び出し元を差し替えるだけで済む。
  移行の判断材料は Stage 06 のベンチ結果とする。

### Rejected

**両対応を初手から作る。** 呼び出し経路が 2 本になり、どちらで生成したかで結果が変わっていないことを
確かめ続けるコストが発生する。実測前に払う理由がない。

---

## ADR-005: 経験レベルを公開ビューに出さない

### Status
Accepted

### Context

PRD の未決定事項 7 が「経験レベルを本人以外に見せるか（シフト表に『初参加』と表示されることへの
心理的抵抗）」を挙げていた。

US-22 は「同じ枠を担当する人が分かる（初参加者が誰に聞けばよいか分かる）」を求めており、
公開ビューに何らかの手がかりは要る。

### Decision

**経験レベル（リード / 経験あり / 初参加）はオーナー画面にのみ出す。** 公開閲覧 URL
(`/r/:viewToken`) には出さない。

公開の個人ビューには「この枠を一緒に担当する人」の**氏名**を出す。初参加者が誰に聞けばよいかは
これで分かる。誰が経験者かをラベルで示す必要はない。

### Consequences

- スタッフは無償のボランティアであり、「次回も来てもらえるか」が目的関数に入っているプロダクトで、
  公開の場に経験の浅さを掲示するのは方針と矛盾する。
- Stage 09 でこれを architecture テストとして固定する。公開ビューのコンポーネントが
  経験レベルを表す型・定数を import していないことを検査する。UI の見た目だけで担保すると、
  後から「便利だから」と復活する。
- オーナー画面では列ヘッダに出す（セル内には出さない。情報量を抑えるため）。

---

## ADR-006: 履歴を JSON スナップショットで持ち、割当テーブルは現在の 1 枚だけにする

### Status
Accepted

### Context

US-18 は「Google スプレッドシートのように操作の履歴を辿れ、任意の時点へ戻せる」ことを求めている。
一方 PRD は「シフト表はイベントごとに 1 つとし、複数案を並行して持たない」とも決めている。
運用上は「今の 1 枚」が常に唯一の正であり、「案を選ぶ」より「巻き戻せる」ほうが実態に合う、という判断。

想定規模（スタッフ 100 名 × 時間枠 60）では 1 時点あたり最大 3,000 件程度の割当になる。
`assignments` 行を時点ごとに複製すると D1 の行数が急激に増える。

### Decision

- **`assignments` テーブルは現在の 1 枚だけを保持する。** 画面表示と最適化はここを読む。
- **履歴は `revisions` に、割当全体を JSON 1 カラムとして保存する。** 各時点の評価指標も一緒に持つ
  ので、重みやシードを変えて再生成した結果を履歴上で比較できる。
- 復元は「その時点の JSON を `assignments` へ展開し直す」操作。
- **連続した手動編集は一定時間まとめて 1 件の履歴にする。** 1 セル動かすたびに履歴が増えると読めない。
- **保持件数に上限を設け、古いものから削除する。**

### Consequences

- `revisions` の JSON は `assignments` の写しであり、スキーマの正本ではない。`assignments` の
  列を変えたら JSON の読み出し側の互換性を考える必要がある。Stage 08 で JSON にバージョン列を持たせる。
- 「案 A と案 B を並べて比較する」はできない。これは PRD の意図的な非機能である。

---

## ADR-007: 役割マスタをマイグレーションでシードする

### Status
Accepted

### Context

PRD の未決定事項 4 が「役割マスタの管理方法（マイグレーションでシードするか、管理画面を用意するか）」
を挙げていた。

一方 Non-Goal には「**イベント固有のカスタム Role の作成**（役割はシステムが用意したものから選択する）」
が明記されている。

### Decision

マイグレーションで 6 件をシードする（`reception` / `guide` / `mc` / `stream` / `photo` / `setup`）。
管理画面は作らない。イベントは `event_roles` で「そのイベントで使う Role」を選ぶだけ。

### Consequences

- 役割を増やすにはマイグレーションが要る。Non-Goal がカスタム Role を排除している以上、
  役割の追加は「プロダクトの仕様変更」であり、デプロイを伴うのが妥当。
- `roles.id` は文字列 ID（`reception` 等）にする。ソルバーのテストやシードデータで
  可読性が要るため、連番の整数にしない。

---

## ADR-008: 代理登録の本人紐付けを email 突合で行う

### Status
Accepted

### Context

US-08 は「口頭で参加を伝えてきた人、当日の飛び入り」のためにオーナーが代理でスタッフを登録でき、
「追加した人が後からサインインすると、その登録を自分のものとして引き取れる」ことを求めている。

一覧から利用者を選ぶ UI にしたいところだが、**`accounts` に利用者検索 API はない**。
公開されているのは自分自身のトークンで呼ぶ `/userinfo` のみである。

### Decision

`tinyurl/` の email-as-principal と同じ方式を採る。オーナーは**メールアドレスを指定して**追加し、
後からサインインした本人と email で突き合わせる。

- `applications.user_id` は NULL 許容。公開 URL 経由は常に非 NULL、**代理登録のみ NULL を許す**
- `UNIQUE(event_id, user_id)` と `UNIQUE(event_id, email)` の 2 本で二重登録を防ぐ
- オーナーが上書きした値は本人の申告値と別に保持しない。**最後に書いた側が勝つ。**
  誰がいつ更新したか（`updated_by` / `updated_at`）だけを残す

### Consequences

- 一覧から選ぶ UI が要るなら `accounts` 側に検索 API を追加する必要がある。**これは roster の
  スコープ外**で、必要になった時点で別の計画を立てる。
- email のタイプミスは引き取りの失敗として現れる。オーナーが一覧で `updated_by` を見て気づける。
- 「最後に書いた側が勝つ」は意図的な単純化。マージ UI を作らないことで、代理登録が
  ただのデータ入力に留まる。

---

## ADR-009: PRD とプロトタイプをリポジトリに置かない

### Status
Accepted

### Context

計画の入力は `local_data/` に置かれた PRD（Markdown）と動作プロトタイプ
（`standalone_demo.html`、4,034 行の単一ファイル、ソルバー込みで実際に動く）だった。
`local_data/` は untracked かつ `.gitignore` 対象外で、放置するとコミットされる状態だった。

### Decision

**どちらもリポジトリに置かない。** `.gitignore` に `local_data/` を追加した。

### Consequences

- **計画ファイルが自己完結でなければならない。** 実装エージェントは PRD もプロトタイプも読めない。
  ドメインモデル、ソルバーのコスト関数と重み、制約の定義、画面仕様、ステータス遷移は
  すべて `index.md` と各ステージファイルに書き写してある。
- **ソルバーの仕様は `index.md` §5 が唯一の正本。** プロトタイプは削除されるため、
  書き写し漏れは復旧できない。実装後は `roster/app/features/solver/` のテストが正本になる。
- 定数（コスト、打ち切り条件、レベル、ステータス）を「だいたい同じ」で実装すると、
  比較対象がないまま挙動がずれる。`index.md` §5.3 の表の数値をそのまま使うこと。

---

## ADR-010: スコープ外として記録するだけの既存の不整合

### Status
Accepted

### Context

新規ワークスペース追加の登録ポイントを調べる過程で、roster とは無関係の既存の不整合が見つかった。
roster の PR で直すと、レビューの対象が混ざる。

### Decision

**roster の PR では直さない。観測事実としてここに記録する。** 必要なら別 issue を立てる。

| 症状 | 実体 |
|---|---|
| `pay` と `website` が同じ dev ポート | 両方 `vite.config.ts` で `5180`。`pay` は `strictPort: true` なので、`website` が先に取ると `pay` が起動に失敗する |
| `pay` の自己記述が実際と違う | `pay/.dev.vars.example` と `pay/AGENTS.md` は `5179` と書いているが実際は `5180`。しかも `5179` は `connpass` が使用中 |
| accounts の `PAY_REDIRECT_URLS` が誤り | `accounts/.dev.vars.example` が `5179` を向いている。`pay` のローカル sign-in は redirect_uri 不一致で失敗するはず |
| `CONTRIBUTING.md` に `pay` の記載がない | dev ポート段落が connpass(5179) から website(5180) へ飛んでいる |
| `GDG_LIB_DEPENDENTS` に `ost` がない | `.github/scripts/changed-workspaces.mjs`。`ost` は `@gdgjp/gdg-lib` に依存しているのに、gdg-lib の変更で `ost` の CI / deploy が走らない |
| `scripts/run-ci.mjs` の `workspaces` Map が不完全 | `pay` / `agents` / `agent-host/langfuse-forwarder` が抜けている。pre-commit の `--changed` 高速パスがこれらを絞り込めない（本体 CI は `changed-workspaces.mjs` 側で拾うので落ちはしない） |
| `ci.yml` の整合性テストが存在しない | `.github/scripts/workflows.test.mjs` は `deploy.yml` しか読まない。`CI_WORKSPACES` の各ワークスペースに `ci.yml` の typecheck / test / build ステップがあるかを検証するテストがない（詳細は `01-workspace-scaffold.md`） |

### Consequences

`roster` を追加するときに `CONTRIBUTING.md` のポート段落は触ることになるが、
**`roster` の行を足すだけに留め、`pay` の欠落は直さない**。差分を roster に閉じるため。
