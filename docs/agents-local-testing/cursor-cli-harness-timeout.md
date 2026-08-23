# Cursor CLI が VM ハーネスで応答しない

## Status

Resolved — 2026-08-23 に Lima VM で確認。

## Impact

`xangi harness invoke` の organizer allow path が Cursor の応答待ちで完了しなかった。
既定モデルを変更後、最小 prompt の organizer allow path は正常に完了した。次の本番同等
E2E 条件は引き続き検証対象である。

- nonce を発行した allow path が `wk read` フォールバックで回答すること
- chapter/national の source-visibility parity
- Google Workspace MCP の初回 OAuth URL 発行と、承認後の同一ツール呼び出しの再試行

role を持たない deny path と、別 chapter の deny path は通っているため、これは IAM
class 解決や harness control socket の問題ではない。

## Environment

- Lima instance: `gdg-agent`（Ubuntu 24.04 arm64）
- Cursor Agent: `2026.08.11-e8db854`
- xangi: `/opt/xangi` の Harineko0/xangi checkout
- workspace: `/srv/gdg-agent/wiki`
- slot: `gdgagent-run-0`
- sandbox: enabled / `readBoundary: workspace`

専用テスト Accounts ログイン、slot 0/1 の Cursor ログイン、slot 0 の Google Workspace
OAuth client 設定は完了済み。Cursor の workspace trust と `google-workspace` MCP の承認も
slot 0 に保存されている。Google refresh token はまだ作成されていない。

## Reproduction

`composer-2.5` を既定モデルにした最小の Cursor 呼び出しは応答を返さなかった。

```bash
limactl shell --workdir / gdg-agent -- sudo -u gdgagent-run-0 sh -lc '
  cd /srv/gdg-agent/wiki &&
  timeout 15 cursor-agent --trust -p "Respond with exactly: ok" --output-format json
'
```

Observed result:

- exit code: `124`
- stdout/stderr: empty
- `cursor-agent` は timeout まで残り続ける

同じ状態で、以下の organizer allow path も Cursor 子プロセスを開始するが、3 分以上
assistant result を返さない。

```bash
limactl shell --workdir / gdg-agent -- sudo -u gdgagent-svc xangi harness invoke \
  --guild test-guild --channel ch-chapter --user test-user \
  --roles role-organizer \
  --message "Use wiki sources to answer a question that requires a chapter page." --json
```

停止後は child process と `/run/gdg-agent/0/nonce` を明示的に回収し、xangi.service が
`active` に復帰することを確認した。

## Controls that passed

```text
ch-chapter + no roles        -> denialReason: no-held-classes
ch-other + role-organizer    -> denialReason: no-effective-classes
```

いずれも slot/runId は `null` で、nonce と Cursor child は残らない。

## Root cause and fix

スロット uid、同じ `HOME`、workspace trust、および sandbox enabled / `readBoundary:
workspace` のまま、`cursor-agent status` は認証済みとなり、Cursor API への TLS 接続も
確立した。そのため uid isolation、認証、または sandbox のネットワーク境界が原因ではない。

このピン留め済み Cursor Agent では `composer-2.5` が 15 秒を超えて無出力で待機する。一方、
同じ条件で `--model gpt-5.3-codex-low` を指定すると 3.7 秒で `{"result":"ok"}` を返した。
`xangi.service.d/model.conf` の `AGENT_MODEL` を `gpt-5.3-codex-low` に変更し、service を
restart する。sandbox を無効化せず、Cursor または Google の production token もコピーしない。

## Non-causal diagnostics

`~/.cursor/projects/srv-gdg-agent-wiki/worker.log` に TypeScript language server の
`ERROR: [object Object]` と exit code 1 が記録される。ただし worker はその後も起動するため、
このログだけを root cause と断定してはならない。

Google Workspace MCP のプロセスとログは、この最小 Cursor 実行では開始されなかった。
よって OAuth callback、URL トンネル、または Google API が直接の失敗箇所だという証拠はない。

## Follow-up validation

1. 完了: slot user と同じ `HOME`、`PATH`、sandbox 設定で認証と API 接続を確認した。
2. 完了: `gpt-5.3-codex-low` で最小 prompt が JSON を返し、organizer allow path も
   `result: "ok"`、chapter-organizer class、slot、run ID を返した。nonce と Cursor child の
   cleanup、`xangi.service` の active 状態も確認した。
3. 未実施: Google Workspace MCP の read-only tool callで OAuth URL → host browser
   callback → retry を検証する。

Cursor の sandbox を無効化したり、production の Cursor／Google tokens を VM へコピーしたりして
回避してはならない。どちらもこの E2E の検証対象である uid isolation と安全境界を失わせる。
