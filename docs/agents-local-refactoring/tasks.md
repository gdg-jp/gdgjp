# agent-host リファクタリング — 残タスク

`index.md` の 14 ステージについて、2026-09-05 時点で残っている作業のみをまとめる。
完了済みの内容は各ステージファイルと `docs/agents-local-mvp/adr.md`（ADR-024〜031）を参照。
01〜09 は実装漏れなし。以下は 10・13・14 のみ。

## Stage 10 — control-plane-release

- [ ] Lima 上での systemd/apparmor/sudoers/useradd の実機統合テストを CI に配線する。
      ADR-030 が「今後の課題」と明記したまま。`.github/workflows/agent-host-release.yml`
      には現状 Lima ステップが無い。
- [ ] リポジトリ設定変更（人間の承認が要る、ADR-030 が記録のみで留めた項目）:
  - branch protection
  - 署名コミット必須化
  - GitHub Environment protection rule
- [ ] 「エージェントから到達できるどの経路もリリース生成リポジトリへ push できない」という
      不変条件を、ファイル権限だけでなく GitHub 側の権限分離（wiki transport token vs
      monorepo write 権限）でもテスト固定する。

## Stage 13 — xangi-packaging

ADR-031 の残タスク 1〜6 は本セッションで完了（`gdg-jp/xangi` への移管、`@gdg-jp/gdg-lib@0.1.0`
publish、xangi の依存切替、CI 修正、ホスト側 GitHub Packages 認証、pin 更新）。

- [ ] **残タスク 7: `/opt/gdgjp` の完全撤去。** コード上の前提（xangi・agents-index・
      langfuse-forwarder の自己完結化）はすべて揃った。`mincra-srv` に旧 `install.sh` が
      作った `/opt/gdgjp` の実体が残っている可能性があるため、`gdg agent-host apply
      --dry-run --diff` でレビューしたうえで operator が物理削除を確認する。
- [ ] xangi のローカル git remote（`~/proj/xangi` 由来の環境に残っていれば）を
      `gdg-jp/xangi` に向け直す。GitHub のリダイレクトで動作はするが、恒久対応ではない。
- [ ] `gdg-lib` パッケージの消費者が増えた場合、Package settings の
      Manage Actions access に都度リポジトリを追加するか、visibility を `internal` に
      変えるかを判断する（今回は `gdg-jp/xangi` のみ追加、private のまま維持）。
- [ ] xangi の `main` ブランチ CI が 2026-08-20 頃から `prettier --check` で
      失敗し続けている（Stage 13 とは無関係の既存 issue）。7 ファイルの format 崩れ
      （`src/account-link.ts` ほか）。別タスクとして spawn 済み。

## Stage 14 — antigravity-backend

機構（ACL ゲート、hooks/settings/permissions バンドル、能力レジストリ）は実装済みだが、
本番投入条件が未達。ADR-032 の残タスク:

- [ ] `pins.antigravity`（version + sha256）を `agent-host.schema.json` に追加し、
      具体的な `agy` バイナリをピン留めする。
- [ ] pin 済みバイナリに対して、ADR-032 の手動実機検証（PreToolUse deny/allow、
      `command(wk)`/`command(gws)` permission ゲート）と同等の E2E をやり直し、
      再現性を確認する。
- [ ] Lima VM 上での OS サンドボックス境界（`--sandbox`/`enableTerminalSandbox`）の
      実機検証。現状 `OSSandbox: "none"` のまま安全側に倒されている。
- [ ] `--dangerously-skip-permissions` とフック `deny` の優先順位を実機で検証する。
- [ ] 上記が揃うまで `backend.go` の `antigravityPolicy.Capabilities()` は
      `OSSandbox: "none"` / `ToolGate: "none"` のままにする
      （`productionMinimum` を満たさないため `backend.name: antigravity` の spec は
      現状 apply されない — 意図した安全側動作）。

## 並行実施可能な軽微な指摘

- Stage 06〜08 の `## Verification` 節に書かれた `diff -r testdata/golden /tmp/golden`
  という検証コマンドが、実装が採用した単一 `tree.json` マニフェスト方式と噛み合わない。
  機能的な実害は無い（`golden_test.go` が同等の検証を担保）が、ドキュメント表記を
  実装に合わせて直す価値はある。
