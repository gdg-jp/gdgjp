# Stage 02 — 公開前コンテンツレビュー（不可逆ゲート）

## Context — 背景とリポジトリ状況

`docs/agents-local-refactoring/index.md` の Stage 02。**依存: Stage 01。Stage 03 の前に必ず完了させる。**

> **このステージは実装タスクではなく人間の判断ゲートである。** delegate してコードを書かせる対象ではない。
> 判断が確定するまで Stage 03（monorepo への統合）を開始してはならない。

`agents-local` は `gdg-jp/agents`（**PRIVATE**）の submodule で、統合先の `gdg-jp/gdgjp` は **PUBLIC**
（`gh repo view` で確認済み）。全体方針で「agents-local を完全に public 化する」と決めたため、
統合すると現在 private な内容が公開される。**これは取り消せない。**
公開されたものはキャッシュ・インデックスされうるため、後から削除しても戻らない。

なお、機構の大部分は**既に public** である: `scripts/gdg-agent/config/*`、
`scripts/gdg-agent/install-layout.sh`（sudoers を生成する本体）、`docs/agents-local-mvp/07-agent-uid-isolation.md`
などは monorepo 側にあり公開済み。したがって実質的な公開範囲の増分は `install.sh`、
`apply-ownership.sh`、AppArmor プロファイル、そして**運用コンテンツ**である。

問題は機構ではなく運用コンテンツのほうにある。

### 読むべきもの

- `docs/agents-local-refactoring/index.md` — 全体方針
- `agents-local/ENVIRONMENT.md` — 本番ホストの実態を記録した文書
- `agents-local/docs/` 配下すべて
- `agents-local/.gitignore` — 何が既に除外されているか（`.env`, `.env.*`, `logs/`, `memories/`, `node_modules/`）

## Design — 設計

### 1. 棚卸し対象（調査で確認済み）

| ファイル | 含まれるもの | 判断が要る理由 |
|---|---|---|
| `agents-local/ENVIRONMENT.md` | ホスト名 `mincra-srv`、operator アカウント名と uid 1000、全チェックアウトのパス台帳、`/usr/bin/node` `cursor-agent` `gdg` の正確なバージョン | 本番ホストの偵察資料。秘密情報は無い（冒頭に「Discord token・gdg credentials・auth.json を書くな」と明記）が構成が丸見えになる |
| `agents-local/docs/discord/gdgkwansai.md` | GDG Greater Kwansai の Discord サーバー ID・カテゴリ ID・チャンネル ID 一覧 | 内部運用データ |
| `agents-local/docs/devfest-2026-timetable-draft-v1.md` | **未公開の DevFest Kansai 2026 タイムテーブル草案**、登壇者情報（8/13 時点）、**private Google Sheets の URL** | 公開意図が明らかに無い。イベント運営上の未公開情報 |
| `agents-local/docs/devfest-2026-timetable-draft-v1.csv` | 同上の CSV | 同上 |
| `agents-local/.agents/skills/gws-*/SKILL.md`（45 本） | 外部由来（`skills-lock.json` によれば `googleworkspace/cli` の `skills/`） | ライセンスと再配布条件の確認 |
| `agents-local/AGENTS.md` | エージェントの人格・運用ルール | 公開してよいか確認（Stage 03 で `agent-host/workspace/` の正本になる） |

各項目について **「移設 / 秘匿化 / そのまま公開」** を決める。既定の推奨:

- `devfest-2026-timetable-draft-v1.*` → **移設**（未公開イベント情報。Google Sheets URL を含む）
- `docs/discord/gdgkwansai.md` → **移設**（内部運用データ。エージェントの動作に必要なら
  spec ではなくホスト側の設定として持たせる）
- `ENVIRONMENT.md` → **秘匿化または移設**。「どこに何があるべきか」は Stage 04 以降 spec が持つので
  この文書の役割自体が縮小する。ホスト名と operator アカウントを落とした構成説明だけ残す案が有力
- `.agents/skills/gws-*` → ライセンス確認のうえ、問題なければ公開

移設先は private な運用リポジトリ、または monorepo 外の運用ドキュメント置き場。

### 2. 公開の仕方 — フラグを倒さず、レビュー済み HEAD だけを import する

**`gdg-jp/agents` の visibility を public に切り替えてはならない。** 切り替えると 100 commit 超の
**履歴全体**が公開され、上表のファイルを HEAD で削除しても履歴には残る。

代わりに Stage 03 で **レビュー済みの HEAD だけを monorepo へ squash import** する:

- `git subtree add --squash` 相当、または `agent-host/` へレビュー済みファイルを置いた単一コミット
- `gdg-jp/agents` は履歴アーカイブとして **private のまま archive** する
- 最終状態は「完全に public」と同じだが、公開範囲がレビュー済みコンテンツに限定される

この方式では git 履歴の考古学は失われる。ただし `.github/scripts/gdg-agent-layout.test.mjs` が持つ
「削除されたファイルが復活していないこと」のアサーション（`:238-249`）は **monorepo 側のテストファイル**
にあるので、そちらの履歴は保たれる。

### 3. secret scan

HEAD 全体に対して secret scan をかける。あわせて確認する:

- `.env` / `.env.*` / `memories/` が実際に tracked でないこと（`git ls-files` で確認）
- `agents-local/lib/langfuse-forwarder/fixtures/sample-events.jsonl` に実データが混入していないこと
- `agents-local/dev/iam-fixture.json` が合成データであること（Discord ID などが実在しないこと）

### 4. 判断の記録

決定を `docs/agents-local-mvp/adr.md` に追記する。最低限:

- 各棚卸し対象の処遇と理由
- squash import を選び full history を公開しなかった理由
- 公開後、本リポジトリへの push が Stage 10 以降で本番ホストの root 相当になること
  （branch protection と署名鍵管理を別途要すること）

### 制約

- **判断が確定するまで Stage 03 を開始しない。** 統合コミットを作ってから「やっぱりこれは非公開に」は効かない
- **移設対象を「とりあえず `.gitignore` に足す」で済ませない。** tracked なら履歴に残る。移設か削除かをはっきりさせる
- このステージでコードを書く必要はない。成果物は判断と、移設/秘匿化されたファイル群

## Files to touch — 変更ファイル

- `agents-local/ENVIRONMENT.md`（秘匿化または移設）
- `agents-local/docs/discord/gdgkwansai.md`（移設）
- `agents-local/docs/devfest-2026-timetable-draft-v1.md`（移設）
- `agents-local/docs/devfest-2026-timetable-draft-v1.csv`（移設）
- `docs/agents-local-mvp/adr.md`（判断の記録）

## Verification — 完了条件と検証

### 完了条件

- 上表の全項目について処遇が決まり、`docs/agents-local-mvp/adr.md` に理由付きで記録されている
- 移設対象が `agents-local` の作業ツリーから消えている
- secret scan がクリーンである
- `gdg-jp/agents` を public に切り替えない方針が記録されている（Stage 03 は squash import で行う）

### コマンド

```bash
git -C agents-local ls-files | grep -E '\.env|memories/'
```

```bash
gitleaks detect --no-git --source agents-local --verbose
```

```bash
grep -rInE 'docs\.google\.com|drive\.google\.com|discord\.com/channels' agents-local --include='*.md' --include='*.csv' --include='*.json'
```

### 回帰として固定すべきテスト

コード変更が主目的ではないため自動テストは最小でよいが、以下は Stage 03 の統合時に固定する:

- **`agent-host/` 配下に Google Sheets / Drive の URL が含まれない**（未公開資料の再混入防止）
- **`agent-host/` 配下に Discord のサーバー ID / チャンネル ID が含まれない**

### 手動 E2E

1. 上表の各ファイルを 1 つずつ開き、処遇を決めて `adr.md` に記録する
2. 移設対象を移設先へコピーし、`agents-local` 側から削除する
3. `git -C agents-local status` で意図した差分だけであることを確認する
4. secret scan を実行し、検出ゼロを確認する
5. **この時点で一度停止し、公開範囲の最終確認を取ってから Stage 03 に進む**
