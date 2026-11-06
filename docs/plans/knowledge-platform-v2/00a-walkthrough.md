# 付録 — 全ステージ完了後のウォークスルー（人間目線 / VM 上の Codex 目線）

**用途:** レビュー用。Stage 01〜07 を実装し終わった時点のアプリケーションを、使う人と VM 上の Codex の
それぞれから追い、変な実装・改善漏れを見つけるために書いた。delegate 対象ではない（見出し規約に従わない）。
**書いた日:** 2026-11-06。§C に、この歩き読みで見つけた問題と、各ステージへの反映状況を置く。
**第 2 ラウンド（同日）:** チャプタースペース、agent ページの非表示設定と編集ロック、翻訳の単純化、§C の要判断 3 点の決定を
反映した。差分は §D。

---

## A. 人間目線

### A-1. サインインして最初に見るもの

1. `https://wiki.gdgs.jp/` を開く → accounts.gdgs.jp でサインイン → 最後に開いたスペース（`user_preferences.last_space_id`）の
   ホームに着く。初回は `/spaces`。
2. `/spaces` には自分が属するスペースが並ぶ。チャプターのメンバーなら必ず `gdg-jp` がある（移行時に全チャプターの
   `member` principal を入れたため）。それ以外に、owner に招待された `shared` スペース、自分で作った `personal` スペース。
3. サイドバーにスペース切り替え。ページ・ソース・検索・レビューはすべてカレントスペースの中で動く。
4. `/spaces` に 3 つのボタン。「個人スペースを作る」→ `u-<userId>`。「チャプタースペースを作る」→ 自分が organizer の
   チャプターを選ぶ → `c-<chapterId>`。同チャプターの member が自動で editor、organizer が owner。他チャプターの人には
   存在しない（404）。「共有スペースを作る」→ 名前と slug。移行ではどれも作らない（Stage 01 §2、§2-b）。
5. チャプタースペースの settings にはメンバー追加 UI が無い。Discord の `/setup` の選択肢にも出ない。「そのチャプターの
   人だけ」が崩れる経路を UI にも API にも作らない（Stage 01 §2-b、回帰テスト）。
6. サイドバー下部の「エージェントが作成したページを隠す」を on にすると、ツリー・カタログ・検索から `origin: agent` が
   消える。人間が書いたページだけの wiki として使える。URL を直接開けば見える（バナー付き）。権限ではない。

**見え方の変化（v1 → v2）:** URL が `/wiki/<slug>` から `/s/gdg-jp/wiki/<slug>` になる。旧 URL は 301（Stage 07 でも残す、§C-1）。
`gdg-jp` だけ使う人にとっては、スペース名が URL に入る以外の違いはない。

### A-2. ページを読む

- `/s/gdg-jp/wiki/<slug>`。本文は v1 と同じ Markdown 描画。`<acl src>` スパンは閲覧者の権限（チャプター role、ソースの visibility、
  `page_access`）で黒塗り or 表示。**ここは v1 のコードがそのまま動く**（`redactPageMarkdown`）。
- ページには `origin: agent | human` のバッジ。agent ページの末尾に「参照ソース」（`sources` front matter）。
- 言語切り替えで英語版。英語版は `translate` ジョブが夜間に更新するので、**日本語の更新から最長 24 時間遅れる**。
  急ぐときはページ上の「英語版を今すぐ更新」（editor 以上、§C-4）。訳はページ全文を 1 回 Codex に通したもので、
  用語の揺れは起き得る（品質より安さ、§8-7）。訳文の `<acl>` スパンは原文と同数・同 `src` でないと受け付けられない。
- 他スペースのページ URL を直接開くと 404（存在を漏らさない）。

### A-3. ページを書く・直す

- エディタ（TipTap + collab DO）は v1 のまま。保存先はカレントスペース。親ページは同スペース内のみ。
- `<acl src="…">` に書けるソースは同スペースのもののみ（別スペースのソース ID は `acl_unknown_source`）。
- **agent が書いたページ（`origin: agent`）は人間には読み取り専用**（§8-6、Stage 04 §3-4）。「編集」の代わりに
  **「エージェントに依頼」**。「この節の日付が古い」「○○の節を足して」と書いて送ると、次の `synthesize` の `JOB.md` に
  載り、反映後に通知が来る。Codex が断ることもある（`log` に理由）。アーカイブ・移動・共有は人間ができる。
  エディタ URL を直接開いても保存は 403。
- **人間が新規に書いたページ（`origin: human`）:** runner がどう提案しても `/sync` は適用せずレビューに積む
  （`human-page-conflict`）。つまり **人間のページは人間だけ、agent のページは agent だけが書く**。混ざらない。
- 旧 §C-6 の「人間が直した agent ページを runner が上書きする」経路は、ロックで消えた。

### A-4. ソースを登録する（editor 以上）

`/s/gdg-jp/sources`。登録フォームは「URL」「Google Drive（Picker）」「Google Chat スペース」「Discord サーバ」の 4 入口
（`REGISTRATIONS`、Stage 02 §2-b）。`discord-channel` の新規登録は無い。

1. **Discord サーバ**を選ぶと、ボットが入っているサーバ → カテゴリとチャンネルのチェックリスト。`autoDiscover` を付けると
   カテゴリ配下の新チャンネルは自動で入る。**1 サーバ = 1 visibility**。「organizer カテゴリだけ organizer 限定にしたい」なら
   同じサーバをもう 1 ソースとして登録する（フォームにその説明が出る）。
2. visibility（`private` / `member` / `organizer` / `chapter-member` / `chapter-organizer`）を選ぶ。v1 と同じ 5 値。
3. 登録すると `status: pending → fetching → ready`。一覧に **「取得」「統合」の 2 列**。取得は v1 の取得状態、統合は
   `integrated_hash != content_hash` の未統合文書数と、スペースの `synthesize` ジョブの滞留（`queued N / leased M / 最古 HH:MM`）。
4. Discord サーバは `hourly`、他は `daily` / `weekly` / `manual`。毎時取得が入っても統合は **1 スペース 1 時間に 1 本**に
   束ねられる（§C-8）。「今すぐ統合」で束ねを外せる。
5. 統合が 24 時間以上止まっているソースは一覧の先頭に警告バッジ。runner が落ちていれば `/admin/runner` へのリンク。
6. visibility を狭めると、全文書が新しい `audience` で再書き込みされる（旧 audience で検索に出続けない）。

### A-5. 検索する

- `/s/gdg-jp/search`: AI Search のヒット一覧（タイトル、抜粋、引用 URL）。**LLM の回答合成は無い**。v1 の `/search` にあった
  「回答」ブロックが消える。これは方針（Worker から LLM を呼ばない）で、精度上の後退ではない。
- `/search`（スペース横断、§C-3）: 見えるスペース最大 10 件を一度に検索し、ヒットにスペース名が付く。
- member で organizer 専用スパンの固有語を検索してもヒットしない（`acl/<audience>/` ミラーが `audience` フィルタで落ちる）。
  organizer ならヒットし、抜粋にスパン本文が出る。
- raw（取り込んだ Discord ログや Drive 文書）は UI の既定では検索対象外。エージェントだけが `layer: raw` を使う。

### A-6. レビュー（`/spaces/<slug>/review`、editor 以上）

未解決フラグの一覧。種別と、押せるボタン:

| kind | 誰が積む | 操作 |
|---|---|---|
| `human-page-conflict` | runner が `origin: human` のページを変えようとした | 差分プレビュー → 「適用」「破棄」（適用は人間の編集として扱う） |
| `acl-untagged` | `verify-acl` が 2 回失敗した統合ジョブ | findings とページへのリンク。**制限ソースを読めない人には件数だけ**（§C-7） |
| `acl-ambiguous-span` | ミラー書き込み時、1 スパンに比較不能な複数 `src` | ページを開いて `src` を整理 |
| `broken-link` | consolidate 後のサーバ側検査 | リンク先を直す |
| `translate-stuck` | 同じページの翻訳が 3 日連続失敗、または 150 KB 超で積めない | ページを開く、分割するか手で訳す |

### A-7. スペース owner

`/spaces/<slug>/settings`（`shared`）: 名前・slug・`lang`・`translate_enabled`（既定 on）、メンバー（`user` / `chapter_role`）の
追加と削除、`discord_guild` / `chat_space` principal の **表示と削除**（付与は Discord の `/setup` と Chat の `/setup` からのみ）。
ここで「このサーバの全員が viewer」であることが見える。
`chapter` / `personal` では名前・`lang`・`translate_enabled` だけ。メンバーは表示のみ（Stage 01 §2-b）。

### A-8. Discord の利用者

- **サーバ管理者（リンク済み、スペース owner）:** `/setup` → 自分が owner の `shared` スペースが選択肢に出る（チャプター・個人は出ない）→ 選ぶ。これでそのサーバの
  全員が、そのスペースの `page` レイヤー（スパン以外の本文）を bot 経由で読める。
- **誰でも:** `/ask <質問>` → 3 秒以内に「調べています…」→ 20〜60 秒後に follow-up: 回答本文、引用（ページ URL と引用文）、👍 / 👎。
  見つからなければ「このサーバで選ばれたスペース（名前）には見つかりませんでした」。
- **公開チャンネルでの回答は `discord_guild` の権限で生成される**（§C-5）。質問者が organizer でも、チャンネルに投稿される回答に
  organizer 専用の内容は出ない。リンク済みの質問者には「自分の権限で再回答（自分にだけ表示）」ボタンが付き、押すと
  ephemeral で自分の権限の回答が返る。DM では最初から自分の権限。
- `/login` でアカウントリンク（PKCE、v1 と同じ）。リンクすると DM の `/ask` で個人スペース・自分が属する他スペースも対象になる。
  チャンネルの `/ask` の対象は `/setup` で選ばれたスペースだけ（個人スペースの内容が公開チャンネルに出ない）。
- **runner が止まっているとき:** 「調べています…」の後 60 秒以内に、検索ヒット上位 5 件の抜粋 + 引用 URL と
  「エージェントが応答していないため検索結果のみ」が返る。沈黙はしない。
- 👍 / 👎 は Langfuse の score になり、月 1 回の評価セット追加（Stage 06）に使う。

### A-9. Google Chat の利用者

- Chat のスペースに bot を追加 → owner が `/setup` 相当のメッセージ → wiki スペースを選ぶ（`chat_space` principal）。
- 質問 → 同期で「調べています…」→ 本回答は bot がサービスアカウントで **同じスレッドに投稿**（Chat API）。
- Chat のスペースも複数人が読むので、回答は `chat_space` principal の権限。「自分の権限で再回答」は DM に届く。
- 事前確認で Chat API が使えなければ、Chat は検索結果だけの縮退応答になる。

### A-10. 運用者（admin）

- `/admin/runner`: runner の `host / version / backend / last_seen_at / running_job_id`、種別ごとの `queued / leased / failed / needs_review`、
  **レート制限で失敗した件数（直近 24 時間）**、最古のジョブの待ち時間。10 分 heartbeat が途切れると Discord の運用チャンネルに通知。
- `/admin/stats`: 鮮度（raw 取得 → 検索可能）、統合遅延、回答遅延の p50 / p95、`expired` 率、翻訳の滞留枚数。
- VM が死んだとき: `infra/oci-runner/README.md` の手順で cloud-init から作り直す（10 分）。**ただし `codex login` は Pro 契約者本人
  しかできない**（§C-9）。不在時は `RUNNER_BACKEND=gemini` で別メンバーの Google アカウントを使う。
- `RUNNER_TOKEN` のローテーション: `wrangler secret put` と VM の `/etc/gdg/runner.env` の 2 箇所。
- 評価（Stage 06）は開発者のローカルで `pnpm --filter @gdgjp/agent eval` と `gdg wiki judge`。本番スペースには当てない。

### A-11. 無くなるもの（v1 利用者が気づく差分）

- `/ingest`（対話的生成 UI）→ `/s/<slug>/sources` へ 301。「ソースを登録すれば統合される」だけになる。
- `/search` の LLM 回答ブロック。
- Vercel の Discord bot → 同じ Discord アプリが Worker で応答する（コマンド名は同じ、`/setup` が増える）。
- 自宅サーバの agent-host と Cursor hooks。利用者からは見えない。

---

## B. VM 上の Codex 目線

### B-0. 共通: どんな環境で起動されるか

| 項目 | 内容 |
|---|---|
| 起動者 | `gdg wiki runner`（systemd、ユーザー `runner`）。Codex は常駐しない。ジョブごとに `codex exec` が 1 プロセス |
| 認証 | `~runner/.codex/auth.json`（個人 Pro）。Codex から見れば普通の ChatGPT サインイン |
| 作業ディレクトリ | ジョブごとに `/var/lib/gdg-runner/<type>/<jobId>/`。終了後に削除 |
| 環境変数 | `RUNNER_TOKEN` / `GDG_*` は **渡されない**（§C-2）。Codex は wiki に直接 HTTP できない |
| sandbox | `synthesize` / `consolidate` / `translate`: `workspace-write`（ネットワーク無し）。`answer`: `read-only` + MCP |
| 承認 | `--ask-for-approval never`。聞かれても誰も答えない |
| 時間 | `synthesize` 30 分、`translate` 15 分（1 ページ）、`consolidate` 30 分、`answer` 75 秒。超えたら SIGTERM → ジョブ `failed`（`answer` は `expired`） |
| 指示の正本 | クローン直下の `AGENTS.md`（サーバ版管理、人間が wiki で編集）。プロンプト本文は短く、`AGENTS.md` を読めと言う |
| 同時実行 | 2 スロット。`answer` 用 1、その他 1。Pro の 5 時間枠は契約者本人と共有 |

### B-1. `synthesize` ジョブで Codex が見るもの

```
/var/lib/gdg-runner/synthesize/<jobId>/          ← -C で cwd
  AGENTS.md            統合方針（v1 03a-agents-md.md の後継。Knowledge routing 表、ページ型、禁止事項）
  JOB.md               今回のジョブ
  pages/               このスペースの全ページ（黒塗り無し、front matter 付き、日本語）
    index.md
    events/devfest-kansai-2026.md
    ...
  raw/<sourceId>/      ジョブ対象ソースの raw だけ（他ソースは無い）
    channels/general/2026-11.md
  .gdgwiki/            clone 状態（revision 表）。触らないと AGENTS.md に書く
```

`JOB.md` の形:

```markdown
# Job synthesize 01J…  space: gdg-jp

## Sources
- id: src_8f2…   kind: discord-guild   visibility: member   title: GDG Kansai Discord
  - raw/src_8f2…/channels/general/2026-11.md   (312 KB, +48 lines since last integration)
  - raw/src_8f2…/channels/staff/2026-11.md     (1.9 MB, +210 lines)  ← 見出し単位で読む
- id: src_a01…   kind: google-doc      visibility: organizer   title: 会場契約メモ
  - raw/src_a01…/doc.md   (24 KB, new)

## Requests
- from: 田中（editor）  page: events/devfest-kansai-2026
  > 会場の節が去年のままです。raw/src_a01… の契約メモに新しい会場があります

## Rules (see AGENTS.md §統合)
- visibility が member より狭いソース（上では src_a01…）由来の記述は <acl src="src_a01…"> で囲む
- origin: human のページは編集しない。提案は pages/log/<date>.md に書く
- Requests は対象ページに反映する。できなければ pages/log/<date>.md に理由を書く
- 1 ソースあたり新規・更新は 15 ページまで
```

`## Requests` は人間が wiki の「エージェントに依頼」で書いたもの（Stage 04 §3-4）。agent ページを人間が直せないので、
これが人間 → Codex の唯一の編集経路。依頼だけのジョブ（`Sources` が空）もある。

Codex がやること: `pages/index.md` と関係するページを読む → raw を読む → ページを編集・新規作成 → `pages/log/` に要約。
`git` は使わなくてよい（runner が `git add -A pages && commit && push`）。

Codex が **知らなくてよい**こと: スペースの存在（cwd が 1 スペース分）、R2、AI Search、ジョブ API。

Codex の後で起きること（Codex には見えない）:
1. `gdg wiki verify-acl --read-sources src_8f2…,src_a01…` → `validate-acl`。`src_a01…` 由来の記述がスパン外にあれば findings。
2. findings があれば **1 回だけ** Codex を再実行（プロンプト末尾に findings: 「以下の記述を `<acl src="src_a01…">` で囲め」）。
3. まだ失敗なら push せず `needs_review` + `review_flags(acl-untagged)`。成功なら push → `/sync` が `acl_required` を最終検査、
   human ページは `skipped` → `review_flags(human-page-conflict)`。`expectedRevision` 不一致（別ジョブが先に push）は
   ジョブごと `failed` → 再キュー。
4. `POST result` → `integrated_hash` 更新、`last_integrated_at` 更新。`enqueueTranslate` が束ねに合流。

Codex 目線の落とし穴（§C で対応）:
- raw が大きいと全文を一度に読もうとして文脈を潰す → `JOB.md` にサイズと差分行数、4 MB 超はジョブ分割（§C-10）。
- `<acl src>` の値を title から推測しがち → `JOB.md` に ID をそのまま書く。
- 「どのページに書くか」で迷う → `AGENTS.md` の Knowledge routing 表（v1 の運用知識）を残す。

### B-2. `consolidate` ジョブ

cwd は `synthesize` と同じクローン。**`raw/` は無い。** `JOB.md` は「重複候補の統合、リンク切れ、`index` と名前空間ページの更新。
新規トピックページは作らない」。1 日 1 回、深夜。LLM 不要の検査（`index` の決定的再生成、`[[slug]]` 切れ）は runner でなく
wiki 側がやるので、Codex は「意味の整理」だけ。

### B-3. `translate` ジョブ（1 ジョブ = 1 ページ）

```
/var/lib/gdg-runner/translate/<jobId>/
  source.md            対象ページの日本語全文（front matter 付き、黒塗り無し）
```

それだけ。`AGENTS.md` も `JOB.md` も用語集もクローンも無い。プロンプト（`prompts/translate.md`、1 段落）は
「`source.md` を英語に訳して `target.md` に書く。Markdown 構造・front matter のキー・`[[slug]]`・URL・コードブロックは
変えない。`<acl src="…">…</acl>` は同じ数・同じ `src` で中身だけ訳す。訳注も前置きも書かない」。15 分。

Codex の後で runner がやること: `target.md` を読んで `POST /api/runner/pages/:id/translation { contentEn, sourceHash }`。
サーバがスパンの数と `src` を原文と比べ（食い違えば `acl_required`）、`sourceHash` が今の `content_ja` と違えば 409
（翻訳中に日本語が変わった。翌晩やり直し）、通れば `content_en` だけ更新。

Codex 目線の落とし穴: 長いページで途中を要約してしまう → プロンプトに「省略しない」、150 KB 超はそもそも積まない。
用語が前回の訳と揺れる → **受け入れる**（品質より安さ、§8-7）。揺れが気になるページは人間が `translation_status_en = human`
にして手で訳せば、以後ジョブは積まれない。

### B-4. `answer` ジョブで Codex が見るもの

```
/var/lib/gdg-runner/answer/<jobId>/              ← read-only sandbox
  INSTRUCTIONS.md      出力 JSON の schema、言語は質問に合わせる、引用無しの断定禁止、無ければ unanswered
  question.md          質問文、質問者の表示名（ID はハッシュ）、対象スペース名
  index.md             対象スペースの index（黒塗り済み）
  hits/01-gdg-jp-events-devfest-kansai-2026.md   黒塗り済み本文、front matter に url
  hits/02-…            （最大 8）
  raw/01-gdg-jp-src_8f2….md                       raw ヒットの **抜粋だけ**（§C-11）
```

MCP サーバ `wiki`（`gdg wiki mcp --token <ジョブ用トークン> --spaces gdg-jp`）の 2 ツール:
`search(query, layers?)` と `read_page(space, slug)`。どちらも質問者（公開チャンネルなら `discord_guild`）の権限で
黒塗り済みのものしか返らない。トークンは 10 分で切れ、`/sync` には使えない。

Codex は `hits/` を読み、足りなければ `search` → `read_page`、`--output-schema` の JSON で終わる。
75 秒。Codex にはクローンも raw 全文も `RUNNER_TOKEN` も無いので、**黒塗りを破る手段が cwd にも環境にも無い**。
runner は `citations[].url` を束と MCP 結果の URL 集合で検査し、無いものは落とす。

### B-5. Codex から見た失敗

| 事象 | Codex 側 | runner 側 |
|---|---|---|
| レート制限（429 相当） | `codex exec` が非 0 で終わる | `failed` + `/admin/runner` の件数。`translate` は翌晩の cron で再投入（1 ページ単位なので途中まで終わった分は残る） |
| タイムアウト | SIGTERM | `synthesize` は `attempts += 1`、3 回で `failed` |
| 承認プロンプトが出る設計の操作 | `never` なので拒否されて続行 | ログに残る。プロンプトで「ネットワークも git も使うな」と先に言う |
| `pages/` 以外を編集 | 見えない | remote helper が push を拒否 → `failed`。`AGENTS.md` と `raw/` の変更は捨てる |

---

## C. 見つけた問題と対応

| # | 問題 | 影響 | 対応 |
|---|---|---|---|
| C-1 | Stage 07 が `/wiki/<slug>` の 301 を消す予定だった。Discord の過去メッセージや外部リンクに旧 URL が残る | リンク切れ | **修正済み** Stage 07 §2: 301 は残す |
| C-2 | runner の環境に `RUNNER_TOKEN` があると `codex exec` の子プロセスに継承され、Codex が自分で `git push` できる（verify-acl を飛ばせる） | 黒塗り検査の迂回 | **修正済み** Stage 04 §3-1 / 制約 / 回帰テスト: `Env` を明示的に組んでトークンを渡さない |
| C-3 | 検索がスペース単位しか無く、`gdg-jp` と自分の `shared` スペースを一度に探せない | 使い勝手 | **修正済み** Stage 03 §4: `/search` 横断（≤10 スペース） |
| C-4 | 翻訳が夜間バッチだけで、日本語更新から英語版に最長 24 時間かかる | 鮮度 | **修正済み** Stage 04 §3-3: 「英語版を今すぐ更新」ボタン（editor 以上、高優先） |
| C-5 | **公開チャンネルの `/ask` を質問者の権限で生成すると、organizer の質問の回答にスパン本文が公開投稿される** | 黒塗りの漏れ（v1 も同じ経路を持っていた） | **修正済み** Stage 05 §2 / §5 / 回帰テスト: チャンネルと Chat スペースは `discord_guild` / `chat_space` principal の権限で生成。リンク済み質問者には ephemeral の「自分の権限で再回答」 |
| C-6 | agent ページを人間が直した後、runner の push が上書きする経路 | 編集の消失 | **解消（第 2 ラウンド）** agent ページは人間が編集できなくなった（§8-6、Stage 04 §3-4）ので経路自体が無い。`expectedRevision` の 409 はジョブ間の競合だけに残り、ジョブ `failed` → 再キュー |
| C-7 | `review_flags(acl-untagged)` の findings に制限ソース由来の記述が入り、レビュー画面が黒塗りの抜け道になる | 黒塗りの漏れ | **修正済み** Stage 04 §7 / 制約: `canAccessSource` を満たす閲覧者だけに本文、他は件数 |
| C-8 | Discord `hourly` 取得が 1 日 24 本の `synthesize` を起こし、個人 Pro の 5 時間枠を runner が食い尽くす | 契約者本人が Codex を使えなくなる | **修正済み** Stage 02 §3: 同スペースの統合は 1 時間 1 本、手動は例外 |
| C-9 | 「cloud-init 1 枚で誰でも作り直せる」が、`codex login` は Pro 契約者しかできない。VM に SSH できる人は契約者の ChatGPT を使える | 復旧が属人化、アカウント共有 | **記録済み** overview §7、Stage 04 README: 契約者不在時は Gemini CLI バックエンド。アカウント共有は受け入れる（SSH 鍵をグループに限定） |
| C-10 | Discord 月次 raw が数 MB になり、Codex が全文を読んで文脈を潰す | 統合品質 | **修正済み** Stage 04 §3-1: `JOB.md` にサイズと差分行数、4 MB 超はソース単位にジョブ分割 |
| C-11 | `answer` の束に raw ヒットをどう入れるか未定義だった（`cat` はページ専用） | 設計の穴 | **修正済み** Stage 05 §3-1: `hit.text` の抜粋だけ `raw/` に入れる。raw 全文を読む API は作らない |
| C-12 | 種別の分岐が 11 箇所に散ったまま `discord-guild` を足す計画だった | 保守性 | **修正済み** Stage 02 §2-b: `SOURCE_KINDS` / `REGISTRATIONS` の 2 表に全面移行、許可リスト無しのアーキテクチャテスト |

### 要判断だったもの（2026-11-06 第 2 ラウンドで決定、overview §8-10 / §8-4）

- **C-5 の既定 → 計画どおり。** 公開チャンネルと Chat スペースは `discord_guild` / `chat_space` の権限で生成。
  チャンネルごとの `audience` 設定は作らない（不満が出たら別計画）。
- **C-9 の受容 → 計画どおり。** 個人 Pro を共有 VM に置く。復旧は契約者、不在時は Gemini CLI バックエンド。
- **翻訳の対象 → 全スペース既定 true。** 1 日 1 回・変更があったページだけなので枚数は小さく、Pro の枠は問題にならない見込み。
  owner は settings で off にできる。

---

## D. 第 2 ラウンドの変更（2026-11-06）

| 要望 | 反映 | 歩き直して気づいたこと |
|---|---|---|
| 「チャプタースペースを作る」。そのチャプターの所属者だけが閲覧・編集 | Stage 01 §2-b（`kind` 別の表、`spaces.chapter_id` UNIQUE、`members.server.ts` が表に無い principal を拒否）、§4 の 3 ボタン、Stage 05 `/setup` は `shared` のみ、overview §8-8 | (D-1) UI で追加ボタンを隠すだけでは API から `discord_guild` を足せてしまうので、拒否はサーバ側 + 回帰テストにした。(D-2) 所属の正本は accounts の claims なので、脱退は次回サインイン時に効く。`space_members` の `chapter_role` 行は固定で、同期処理は要らない |
| agent 作成ページを UI で非表示にするオプション | Stage 01 §4（`user_preferences.hide_agent_pages`、ツリー・カタログ）、Stage 03 §4（検索の後置フィルタ）、overview §8-9 | (D-3) `origin` は AI Search のメタデータ 5 枠に入っていないので検索側で絞れず、D1 の `pages.origin` で後置フィルタ。取得件数を 2 倍にして切る。(D-4) 「隠す」を権限と混同しないよう、URL 直打ちは開ける + バナー、と明記した |
| agent ページは人間が編集不可。直したいときはエージェントに頼む | Stage 04 §3-4（`canHumanEditPage`、本文・タイトルのみロック、「エージェントに依頼」→ `payload.requests` → `JOB.md ## Requests`、通知）、§3-1 の 409 の意味変更、overview §8-6 | (D-5) 「頼む」経路を定義しないと人間が agent ページを直す手段が無くなるので、ページ上のボタンから `synthesize` に依頼を載せる形にした。Discord からの依頼は作らない。(D-6) ロックを `getEffectivePagePermissions` に入れると内側 ACL を触ることになるので別関数で AND。(D-7) ロックで `expectedRevision` の 409 は「別ジョブが先に push」だけになるため、clone 系ジョブをスペース単位で直列化し、409 はジョブごと `failed` → 再キュー（半分だけ反映を作らない）。C-6 は解消 |
| translate は 1 ページ全文を渡して英語にするだけ（品質より安さ） | Stage 04 §3-3 全面書き換え（1 ジョブ 1 ページ、`source.md` → `target.md`、`/api/runner/pages/:id/translation`、`translation_source_hash`、150 KB 上限、`TRANSLATE_NIGHTLY_CAP`）、Stage 07（`translation_segments` も削除）、overview §4 / §8-7、B-3 | (D-8) `/sync` に乗せると 1 ページのために全スペースを clone するので、runner 専用の受け口にした。受け口でもスパン検査は省かない（英語版だけ黒塗りが外れる経路）。(D-9) 翻訳中に日本語が変わる競合は `sourceHash` の 409 で翌晩に送る。(D-10) v1 は JA 保存ごとにキューへ入れていたが、v2 は日次差分なので「最後に訳した原文のハッシュ」列が要る |
| C-5 / C-9 / 翻訳の既定 | 上記「要判断だったもの」 | — |

### 確認したが問題なしとしたもの

- 未リンクの Discord ユーザーが `discord_guild` 経由で見るのは `page` レイヤーだけで、内側 ACL は「所属なし」。`member` 以上のソースと
  スパンは見えない。v1 の「最初にリンクした人の資格を借りる」より厳しくなる。
- `private` ソースは移行後も `gdg-jp` の中で本人だけに見える（内側 ACL がそのまま効く）。個人スペースに動かす必要はない。
- `runner` identity は `/sync` でも `acl_required` を免除されない（Stage 04 §1）。
- AI Search の `audience` は `sourceAudienceKey` から、質問者側は `canAccessSource` から組む。判定器は 1 本のまま。
