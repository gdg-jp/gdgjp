---
name: plan-creator
description: このリポジトリで実装計画（plan file / docs/plans/*.md）を書くときの規約。/cursor:from-plan や /cursor:delegate に渡す計画、plan モードの成果物、段階分割した実装計画、tasks/ に変換する計画を書く・直す・レビューするときは必ずこの skill を読むこと。「計画を立てて」「plan を書いて」「docs/plans に保存して」「cursor に実装させたい」「段階ごとの計画」と言われたときも該当する。見出しを 1 つ間違えるだけで計画の中身がまるごと捨てられるため、書き始める前に読む価値がある。
---

# 実装計画の書き方

## この skill がある理由

`/cursor:from-plan` は計画ファイルを `tasks/<timestamp>-<slug>.md` に変換して Cursor に渡す。
このとき **`## ` 見出しの文字列で機械的に抽出する**ため、見出しが規約から外れると本文がまるごと捨てられる。

実際に起きた失敗:

```
## Repo context
(no Context section in the source plan)

## Acceptance criteria
(no Approach / Plan / Implementation section in the source plan)
```

日本語見出し（`## 目的` `## 設計`）で書いた 200 行の計画が、タイトル 1 行だけの task ファイルになった。
気づかず delegate していれば、Cursor はタイトルだけを頼りに実装していた。

## 見出し規約（機械的な契約）

変換器は `## ` 見出しを小文字化し、以下のリストに**前方一致**するかで振り分ける。
一致判定は `key === hint || key.startsWith(hint + ':') || key.startsWith(hint + ' ')`。

| 抽出先（task 側の見出し） | 使えるキーワード（先頭一致） |
|---|---|
| `## Repo context` | `context` / `background` / `why` / `motivation` |
| `## Acceptance criteria` | `approach` / `plan` / `implementation` / `solution` / `design` |
| `## Files to touch` | `files to touch` / `files to modify` / `critical files` / `file-by-file change list` / `files` |
| `## How to verify` | `verification` / `how to verify` / `test plan` / `tests` / `acceptance criteria` |

英語キーワードで始めれば日本語を続けてよい。この repo の計画は以下で統一する。

```markdown
# <計画のタイトル>

## Context — 背景とリポジトリ状況
## Design — 設計
## Files to touch — 変更ファイル
## Verification — 完了条件と検証
```

`# ` タイトルは task の `## Goal` になる。スラッグ化で日本語は落ちるので、
`# Stage 3 — ローカル Ingest ツールチェーン` は `stage-3-ingest` になる。
英数字だけで内容が分かる語を先頭に置くとファイル名が読める。

## 落とし穴

**最初の `## ` より前は捨てられる。**
「依存: Stage 1」「対象ワークスペース: wiki/」のようなメタ情報をタイトル直下に置くと消える。
Context の中に入れること。

**`## Constraints` は書いても無視される。**
変換器は常に定型文（既存規約に従え／リストにないファイルを触るな／lockfile を変えるな）を差し込む。
リポジトリ固有の制約を伝えたければ `### 制約` として Design の中にぶら下げる。
`###` 以下は節の本文として一緒に運ばれる。

**`Verification` と `Acceptance criteria` は同じ枠を奪い合う。**
どちらも verification 用のキーワードで、`verification` が先に評価される。
両方書くと `## Acceptance criteria` の内容が落ちる。完了条件は Verification 節に統合する。

**抽出されるのは 4 節だけ。**
「リスク」「未解決事項」「参考リンク」などの節は task に載らない。
実装に必要な情報なら 4 節のどれかに入れる。載せないなら、計画側の読み物として置くのは構わない。

## 各節に何を書くか

実装エージェントは**リポジトリを知らない状態で来る**。既存実装を教えなければ必ず車輪を再発明する。
節の役割はそこから逆算する。

### Context — 背景とリポジトリ状況

- **なぜやるか。** 解こうとしている問題、きっかけ、目指す結果
- **依存と対象範囲。** 先行ステージ、触ってよいワークスペース
- **読むべきもの。** `CLAUDE.md`、feature の `README.md`、関連する計画ファイル。パス付きで
- **再利用する既存実装。** パスと「何が既にできているか」。書き直させないため

例:

```markdown
### 再利用する既存実装

- `wiki/workers/features/ingestion/tools/google-docs/workspace.ts`
  — Doc のタブ走査・画像抽出。**すでに実装済みなので書き直さない**
- `wiki/app/lib/db.server.ts` の `getDb(env)` — Drizzle インスタンス
```

付録や別ファイルに実装内容がある場合（`03a-agents-md.md` のような全文ドラフト）は、
**Context から明示的に読ませる**。付録自体は delegate されないので、参照がないと存在しないのと同じになる。

### Design — 設計

仕様の本体。task では `## Acceptance criteria` になるので、「こうなっていれば完成」と読める粒度で書く。

- 番号付きの節（`### 1. データモデル`）に割る。実装順にもレビュー順にもなる
- テーブル定義、API パス、ファイル配置のような決まりごとは表やコードブロックで確定させる
- 判断が必要な箇所は判断基準ごと書く。「いい感じに」は実装者ごとにぶれる
- 末尾に `### 制約` を置く

制約には**理由を添える**。理由のない禁止は、都合が悪くなると回避される。

```markdown
- `remote_helper.go` の「`pages/**` 以外を拒否する」検査を緩めない。これは安全装置である
- `wiki/schema.sql` は生成物。手で編集せず `migrate:local` で更新する
```

スコープ境界も制約に書く。「これは別ステージの担当だから触るな」を明示しないと、
親切心で隣接領域まで書き換えられる。

### Files to touch — 変更ファイル

触るファイルのパスを列挙する。新規は「（新規）」と明記する。
ワークスペースごとに小見出しで分けると、モノレポでどこを触るかが一目で分かる。

網羅性より、**当たりをつけさせること**が目的。「このあたりを見ればいい」が伝わればよい。

### Verification — 完了条件と検証

4 つを順に書く。

1. **完了条件** — 何が観測できたら終わりか
2. **コマンド** — コピペで実行できる形。生成物の再生成（`cf-typegen` など）を忘れると壊れるなら、そう書く
3. **回帰として固定すべきテスト** — 特に**静かに壊れる経路**
4. **手動 E2E** — 番号付きの手順

3 が一番効く。実際に見つかった例:

```markdown
- **ja だけのクローンから push しても `content_en` が消えない**（部分ロケール更新）
```

sync API が両ロケールを毎回上書きしていたため、単一言語クローンを導入すると
push した瞬間に全ページの英語版が消える経路があった。
こういう「テストがないと事故ってから気づく」ものを名指しで置く。

## 段階分割

大きい計画は 1 ステージ 1 ファイルに割り、`docs/plans/` に置く。

```
docs/plans/
  00-<topic>-overview.md    全体方針、三層構造、依存グラフ、リスク
  01-<stage>.md             ステージごと。delegate 単位
  02-<stage>.md
  03a-<appendix>.md         付録。delegate せず、本編の Context から参照させる
```

- overview には**依存関係と並行可能性**を書く（`1 → 2`、`1 → 3 → 4`、`2 と 3 は並行可`）
- 1 ステージは 1 回の delegate で完結する大きさにする
- ステージ間で「これは次のステージの担当」を相互に明記し、境界を二重に守る
- overview 自体は delegate しない。見出し規約に従う必要もない

## 書いたら検証する

生成してから目視で気づくのは遅い。パーサを直接呼んで確認する。

```bash
node .claude/skills/plan-creator/scripts/check-extraction.mjs docs/plans/*.md
```

4 節すべてが `OK` になってから delegate する。
付録ファイルが `MISSING` なのは正常（delegate 対象でないため）。

## アンチパターン

**生成された task ファイルを手で埋める。**
一度は動くが、計画を直して再生成すると消える。task は生成物として扱い、**計画側を直す**。

**日本語だけの見出しで書く。**
`## 目的` `## 設計` `## 検証` は 1 つも抽出されない。空の task ができる。

**曖昧なまま delegate する。**
実装者は質問できない。判断が割れる箇所は、計画時点で `AskUserQuestion` で潰しておく。
「どちらでもいい」と思った箇所ほど、後から作り直しになる。

**外部サービスの前提を確認せずに計画する。**
API の有効化やスコープ付与が要るステージは、**冒頭に「実装前に疎通確認し、通らなければ止まって報告する」と書く**。
確認せずに実装させると、動かない理由の切り分けに時間が溶ける。
