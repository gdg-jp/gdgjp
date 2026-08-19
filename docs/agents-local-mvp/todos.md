# 実装順チェックリスト

`docs/agents-local-mvp/` のステージを、依存関係の順に並べたもの。
**番号は ID であって順序ではない**（[index.md](index.md) の表と同じ内容を、進捗管理の形にしたもの）。

---

## Wave 1 — 最初に実施

- [x] **00** [Node ネイティブ TypeScript 基盤](00-typescript-runtime.md) — 依存なし

## Wave 2 — 並行して着手できる

- [x] **01** [ACL 評価器を `gdg-lib` へ](01-acl-evaluator-gdg-lib.md) — 依存: 00
- [x] **02** [inline source API + マニフェストの `chapterId`](02-wiki-inline-source-api.md) — 依存なし
- [x] **03** [`Principal` の配管、既定権限を閉じる](03-xangi-principal-plumbing.md) — 依存なし

## Wave 3

- [x] **04** [認可サーバ・nonce・IAM](04-xangi-authz-iam.md) — 依存: 03

## Wave 4 — 並行して着手できる

- [ ] **11** [`wk` メディエータ](11-wk-mediator.md) — 依存: 01, 02, 04
  - **ここが権限モデルの中核。ゲートより先に作る。**
  - ゲートが無くても単体で検証できる（nonce を渡して `wk read` を叩く）
- [ ] **08** [エピソード記憶の書き出しとアップロード](08-episodic-memory.md) — 依存: 02, 04
- [ ] **09** [`agents-index` ローカルインデックス](09-agents-index.md) — 依存: 01, 02, 04

## Wave 5 — 並行して着手できる。どちらも 11 が前提

- [ ] **05** [`preToolUse` ゲート](05-cursor-harness-pretooluse.md) — 依存: 00, 11
  - **11 より先に入れない。** Read を deny されたエージェントに代替手段が無くなる
- [ ] **06** [`wk write` の `<acl>` 自動挿入](06-acl-span-autoinsert.md) — 依存: 11

## Wave 6

- [ ] **07** [uid 分離と OS サンドボックス](07-agent-uid-isolation.md) — 依存: 05
  - **07 が通るまで本番投入しない**（下記の関門）

## Wave 7

- [ ] **10** [睡眠スケジューラ](10-sleep-scheduler.md) — 依存: 06, 08

---

## 止まって報告する関門

**通らなかったら次に進まず、設計に戻る。**

### 05 に着手する前

- [ ] `~/.cursor/hooks.json` の `preToolUse` が `failClosed: true` 付きで発火し、
      `{"permission":"deny"}` で Shell と Read を止められる
- [ ] `--force` / `--yolo` 無しで headless（`-p`）が実用に耐える
- [ ] **`cursor-agent` が Read の deny を受けて `wk read` に切り替える**（同じ Read を繰り返さない）
- [ ] **Write / Edit の deny 下で、`wk write` だけで ingest 相当の作業が完走する**
  - 落ちた場合の代替案は [05 の「実装前に疎通確認すること」](05-cursor-harness-pretooluse.md) にある

- [ ] `--mcp-config <path>` を渡したとき、`~/.cursor/mcp.json` と
      `<projectRoot>/.cursor/mcp.json` が**読まれない**
      （読まれるなら [05 §3-5](05-cursor-harness-pretooluse.md) の
      `beforeMCPExecution` を足す判断になる）

### 07 に着手する前

- [ ] `sandbox.mode: "enabled"` + `readBoundary: "workspace"` で
      ingest 相当の作業（`git`、`gdg wiki`、`pages/` の読み書き）が完走する

### 本番投入する前（07 の完了が条件）

- [ ] **05 / 06 を入れただけの状態を本番のギルドに向けない。**
      ゲートとフックは**同一 uid では `rm` 一発で消える**ので、07 までは境界ではない
      （[ADR-004 の脅威モデル](adr.md#脅威モデル)）。テスト用ギルドだけで回す。
- [ ] 07 の完了条件（uid 分離・所有権・サンドボックス・`--mcp-config`）が全部通っている

> **参考**: 「05 と 07 を原子的に配備しないと `wk read` で運用者の認証情報が漏れる」という
> 指摘は**採らない**。Stage 05 のゲートは
> `pages/**` / `raw/**` / `memories/**` **以外**の `Read` を意図的に通すので、
> `~/.config/gdg/credentials.json` の露出は 05 の前後で変わらない（05 以前は素の `cat` で読める）。
> 露出を閉じるのは 07 の uid 分離であり、そこまで**本番に出さない**ことがここでの対策である。
> ただし **`wk` 自身が clone 外を読める必要は無い**ので、
> [Stage 11 §3-0](11-wk-mediator.md) で clone 外を拒否する。

---

## 途中で崩れやすい前提

進めながら、ここが崩れていないかを見る。根拠は [adr.md](adr.md)。

- [ ] `wk` に逃げ道（`--raw` / `wk cat` / `wk sh -c` / `wk write --no-verify`）を作っていない
- [ ] ゲート（`acl-gate.ts`）に ACL 判定が入っていない（判定は `wk` に 1 本化）
- [ ] `afterFileEdit` を復活させていない（挿入点は `wk write` の 1 箇所）
- [ ] `wk` とゲートが `acl-core.ts` を共有している（二重実装しない）
- [ ] `.gdgwiki/acl-sources.json` に会話ソースの id が積まれている（08 と 10）
- [ ] `XANGI_AUTHZ_*` を `ALLOWED_ENV_KEYS` に載せていない（04 と 07）
- [ ] **`channelAudience` がクラス集合と別に運ばれ、読み取りが `…InChannel` 版で
      判定されている**（01・04・09・11）。全国写像のチャンネルで
      `chapter-*` の材料が読めないこと
- [ ] **MCP が既定 deny で `search` だけが通り、`mcp.json` が root 所有 + `--mcp-config`**
      （05 と 07・09）
- [ ] **`wk` がパスを正規化し、clone 外と `..` 侵入を拒否している**（11）
- [ ] **`wk write` が `pages/**/page.md` の allowlist になっている**（11）
- [ ] **リポジトリミューテックスが入り、トレースが invocation ごとに分かれている**（10 と 11）
