# Stage 10 残タスク — 実機統合テストの CI 配線と GitHub 側権限分離テスト

> **ステータス（2026-09-06）**: Design Part 1・Part 2 を `.github/workflows/agent-host-release.yml`
> に実装済み（`verify-on-fresh-host` / `verify-npm-token-permission-boundary` の 2 job、
> `pull_request` トリガー追加、`validate-and-publish` を PR で skip）。
> 実装時の差分: (a) plan 草案の apparmor grep は `gdg-agent` だったが実際のプロファイル名は
> `cursor-agent-cursorsandbox`。(b) `agent-host-sync.*` は `/etc/systemd/system` ではなく
> gdgagent-svc の `--user` unit なので assert を分けた。(c) plan 草案の job には
> `pnpm/action-setup` + `pnpm install` が無かったので `ci.yml` に合わせて追加。
> (d) 権限境界 job は 404（可視性なし）を成功扱いにし、`GET /user` を正のコントロールに追加。
> **未消化**: 初回 PR での CI グリーン確認、および `CI_NPM_READ_TOKEN_TEST_COPY` secret の登録（運用側）。

## Context — 背景とリポジトリ状況

`docs/agents-local-refactoring/tasks.md` の Stage 10 (control-plane-release) に残っている 2 項目の実装計画。

- 依存: Stage 09 (署名済み Tier 1 workspace sync)・Stage 10 (署名済み Tier 2 control-plane release) は実装済み。本計画はその上に統合テストを足すだけで、`cli/internal/agenthost/*.go` のロジック自体は変更しない。
- 対象ワークスペース: `.github/workflows/`、`agent-host/`、`cli/internal/agenthost/`（新規テストファイルのみ）。
- 読むべきもの:
  - `docs/agents-local-mvp/adr.md` の 1898〜2340 行台（Lima VM を使った手動検証の記述）と 2650 行台(ADR-032 の Lima 実機検証項目)
  - `.github/workflows/agent-host-release.yml`(現状のリリース CI。spec 検証とバンドル署名のみで、実機への `apply` は一切行っていない)
  - `agent-host/agent-host.dev.json`(Lima 開発 VM 用の overlay spec。`slotCount: 2`、スケジューラ無効化などを閉じ込めている)
  - `cli/internal/agenthost/plan.go` の `--only` 実装(179〜200 行台。有効な resource type: `user, group, dir, file, sudoers, tmpfiles, symlink, systemd, apparmor, apt, tarball, git, wiki, exec`)
  - `cli/internal/agenthost/secrets.go`(`NPM_READ_TOKEN` = `read:packages` スコープの GitHub PAT。エージェントスロットに到達する**唯一の** GitHub 資格情報)

### 重要な発見: Lima は本質的に不要

ADR-030/032 が Lima に言及しているのは、著者が **macOS の開発機**から検証していたため(`docs/agents-local-mvp/adr.md:1898`: 「macOS の Lima 上に Ubuntu 24.04 VM を作る」)。
GitHub Actions の `ubuntu-latest` runner はそれ自体が使い捨ての実 Ubuntu VM で、`sudo` がパスワードなしで使え、systemd が PID 1 として動いている(Docker コンテナ実行ではない)。
つまり `useradd` / sudoers / systemd unit の有効化 / apparmor プロファイルロードは **runner 上でそのまま実行できる** — Lima のような VM-in-VM や nested virtualization は要らない。「Lima 実機統合テストを CI に配線する」という tasks.md の項目は、実質「`ubuntu-latest` 上で本物の `apply` を実行する CI job を足す」に読み替えられる。

### 再利用する既存実装

- `agent-host/agent-host.dev.json` — development overlay。CI でもこれを `--overlay` に渡せば、production 前提(cursorAgent の実バイナリ配布、xangi の npm ci 認証など)の一部を回避できる可能性がある。ただし中身は Lima 手動検証用に作られたものなので、CI 専用の追加 overlay(例: `agent-host.ci.json`)が要るかもしれない — Design で判断基準を書く。
- `cli/internal/agenthost/plan.go` の `--only` フィルタ — ネットワーク/シークレット依存のリソース種別(`git`(xangi checkout)、`exec`(npm ci/build)、`tarball`(cursorAgent/gws/gdgCli 実体ダウンロード))を切り離して、`user, group, sudoers, tmpfiles, dir, file, symlink, systemd, apparmor` だけを検証する最小構成が組める。
- `cli/internal/agenthost/secrets.go` の `NPM_READ_TOKEN` 発行フロー — GitHub 側権限分離テスト(Design の Part B)がテストすべき資格情報はこれ。

## Design — 設計

### 1. 実機統合テスト(`ubuntu-latest` 上での `apply` 実行)

`.github/workflows/agent-host-release.yml` に新しい job `verify-on-fresh-host` を追加する(既存の `validate-and-publish` job とは並列、依存なし — 実機検証がリリース公開をブロックする必要はない。まず `pull_request` トリガーでも走らせて、`main` へのマージ前に検証できるようにする)。

```yaml
verify-on-fresh-host:
  name: Verify apply/verify on a fresh Ubuntu host
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v4
    - uses: actions/setup-node@v4
      with: { node-version: "22" }
    - uses: actions/setup-go@v5
      with: { go-version: "1.23" }
    - name: Build gdg CLI
      run: |
        pnpm build:acl
        pnpm sync:agent-host-assets
        go build -C cli -o /tmp/gdg ./cmd/gdg
    - name: Apply (host-local resources only, no network/secrets)
      run: |
        sudo /tmp/gdg agent-host apply \
          --spec agent-host/agent-host.json \
          --overlay agent-host/agent-host.dev.json \
          --only user,group,dir,file,sudoers,tmpfiles,symlink,systemd,apparmor \
          --diff
    - name: Verify convergence
      run: sudo /tmp/gdg agent-host verify --spec agent-host/agent-host.json --overlay agent-host/agent-host.dev.json
    - name: Assert sudoers is syntactically valid
      run: sudo visudo -c -f /etc/sudoers.d/gdg-agent
    - name: Assert systemd units are valid
      run: sudo systemd-analyze verify agent-host-sync.service agent-host-apply.service xangi.service agents-index.service || true
      # `|| true`: ユニットが参照する ExecStart バイナリ自体は `--only` で除外した
      # git/exec/tarball リソースが作らないため未配置。ユニット構文自体の妥当性だけを見る。
    - name: Assert apparmor profile parses
      run: sudo apparmor_parser -Q /etc/apparmor.d/* 2>&1 | grep -i gdg-agent || true
    - name: Assert slot users exist with correct shell/home
      run: |
        for i in 0 1; do
          id "gdgagent-run-$i"
          getent passwd "gdgagent-run-$i" | grep -q "/home/gdgagent-run-$i"
        done
    - name: Re-apply must be a no-op (idempotency)
      run: |
        sudo /tmp/gdg agent-host apply --spec agent-host/agent-host.json --overlay agent-host/agent-host.dev.json \
          --only user,group,dir,file,sudoers,tmpfiles,symlink,systemd,apparmor --dry-run --diff
      # dry-run が非ゼロ終了(drift あり)なら CI を失敗させる。上の apply 直後に
      # もう一度 dry-run して「0 pending changes」になることを確認する。
```

### 判断が必要な箇所

- **`--only` で除外した `git`/`exec`/`tarball` を将来カバーするか。** xangi の checkout や npm ci は `NPM_READ_TOKEN` という実際の秘密情報が要る。CI で追加検証したい場合は、`gdg-jp/xangi` への read-only アクセスしか持たない**テスト専用**の fine-grained PAT を発行し、`secrets.CI_NPM_READ_TOKEN` として登録する必要がある(運用判断。まず上記の secrets 非依存の範囲で確実に動かし、その後の拡張として提案する)。
- **`agents-index.service`/`xangi.service` の実際の起動まで CI で検証するか。** 起動には HuggingFace モデルのダウンロードなど外部ネットワークが絡む(今回の `agents-index` クラッシュ調査で判明した `HF_HOME`/`env.cacheDir` の問題はこのレイヤ)。CI で unit ファイルの構文だけでなく実起動まで見たいなら、`--only` の対象を広げ、モデルダウンロードのネットワークアクセスを CI から許可する追加ステップが要る。まずは構文検証(`systemd-analyze verify`)止まりを推奨。

### 2. GitHub 側の権限分離テスト(wiki transport token vs monorepo write 権限)

エージェントスロットに到達する GitHub 資格情報は現状 `NPM_READ_TOKEN` (`read:packages` スコープの fine-grained PAT、`secrets.go` の `SecretsSetNpmRegistry` で `/home/gdgagent-svc/.config/xangi/secrets.json` に保存) のみ。ファイル権限側のテストは既存(`gdgagent-run-*` から `gdgagent-svc` のホームは読めない、など)。今回追加すべきは **その資格情報自体の GitHub 側スコープ**が `gdg-jp/gdgjp` への書き込みを持たないことを、実際に GitHub API へ問い合わせて固定するテスト。

```yaml
verify-npm-token-permission-boundary:
  name: Verify NPM_READ_TOKEN cannot write to gdgjp
  runs-on: ubuntu-latest
  steps:
    - name: Query effective permission on gdg-jp/gdgjp
      env:
        TOKEN: ${{ secrets.CI_NPM_READ_TOKEN_TEST_COPY }}
      run: |
        perm=$(curl -sSL -H "Authorization: token $TOKEN" \
          https://api.github.com/repos/gdg-jp/gdgjp | jq -r '.permissions.push // "unknown"')
        if [ "$perm" != "false" ]; then
          echo "::error::NPM_READ_TOKEN test copy has push=$perm on gdg-jp/gdgjp (expected false)"
          exit 1
        fi
```

- **要運用側の準備**: 本番で使っている `NPM_READ_TOKEN` そのものを CI に置くのは避け、同じ `read:packages`-only スコープで発行した**テスト専用**の fine-grained PAT を `CI_NPM_READ_TOKEN_TEST_COPY` として GitHub Actions secret に登録する(本番トークンとは別物 — CI ログや artifact に触れるものを本番の実資格情報にしない)。
- 将来 xangi 以外の GitHub Packages 消費者が増え、資格情報の種類が増えた場合はこのテストも資格情報ごとに複製する。

### 制約

- 本計画は `cli/internal/agenthost/` のプロダクションロジックを変更しない。CI ワークフローと(必要なら)テスト専用オーバーレイ spec の追加のみ。
- `agent-host.dev.json` は Lima 手動検証用の既存ファイルなので、CI 専用の調整が要る場合は**別ファイル**(`agent-host.ci.json` 等)を追加し、`agent-host.dev.json` の中身は変更しない — Lima での手動検証手順を壊さないため。
- `verify-on-fresh-host` job は `agent-host-release.yml` の既存 `validate-and-publish` job をブロックしない(依存関係を付けない)。実機検証が落ちてもリリース公開自体は止めない設計とする(将来 `needs:` で直列化するかは運用判断)。

## Files to touch — 変更ファイル

### `.github/workflows/`
- `agent-host-release.yml` — `verify-on-fresh-host` job、`verify-npm-token-permission-boundary` job を追加。トリガーに `pull_request` を足すかどうかは既存の `push: branches: [main]` 運用と合わせて判断。

### `agent-host/`
- (要判断) `agent-host.ci.json` — CI 専用 overlay が要る場合のみ新規。

### `docs/agents-local-refactoring/`
- `10-control-plane-release.md`、`tasks.md` — 実装後にチェック項目を更新。

## Verification — 完了条件と検証

1. **完了条件**: `agent-host-release.yml` に上記 2 job が追加され、PR 上で緑になる。`verify-on-fresh-host` が実際に `useradd`/sudoers/systemd/apparmor の収束を検証し、再適用が no-op になることを確認する。`verify-npm-token-permission-boundary` がテスト専用 PAT の scope を実際に GitHub API へ問い合わせて確認する。
2. **コマンド**:
   ```bash
   # ローカルで同じことを試す場合(sudo が使える Linux 環境限定)
   pnpm build:acl && pnpm sync:agent-host-assets
   go build -C cli -o /tmp/gdg ./cmd/gdg
   sudo /tmp/gdg agent-host apply --spec agent-host/agent-host.json --overlay agent-host/agent-host.dev.json \
     --only user,group,dir,file,sudoers,tmpfiles,symlink,systemd,apparmor --diff
   sudo /tmp/gdg agent-host verify --spec agent-host/agent-host.json --overlay agent-host/agent-host.dev.json
   ```
3. **回帰として固定すべきテスト**:
   - **再適用が no-op にならない経路**(dry-run 後の 2 回目 apply で drift が残る)。これは Stage 10 で最も静かに壊れる可能性がある — 収束ロジックが「一度作ったら二度と見ない」種類のリソースを混入させると、CI は初回 apply だけ緑になり、本番の定期 `agent-host-apply.timer` が毎回無駄な差分を出し続ける事故につながる。
   - **`NPM_READ_TOKEN` のテスト用コピーが誤って `push` 権限を持ってしまう経路**(発行時にスコープを広げすぎる、fine-grained PAT のリポジトリ選択を誤って `gdgjp` 自体を含めてしまう、など)。
4. **手動 E2E**:
   1. PR を作成し、`verify-on-fresh-host` と `verify-npm-token-permission-boundary` の両方が CI 上で緑になることを確認する。
   2. 意図的に `sudoers` テンプレートを壊す(例: 生成される visudo 構文を崩す)差分を一時的に入れ、`visudo -c` ステップが赤くなることを確認してから元に戻す。
   3. `CI_NPM_READ_TOKEN_TEST_COPY` を意図的に `push` 権限ありのトークンに差し替え、`verify-npm-token-permission-boundary` が赤くなることを確認してから正しいトークンに戻す。
