## 本番同等 IAM E2E は未完了

空 IAM の `unbound-guild` deny は socket/CLI の配線確認にすぎず、完了条件には数えない。

`karaage0703/xangi` からの差分を含む `Harineko0/xangi`、`gdg-jp/gdgjp`、`gdg-jp/agents` の
本番同等結合テストとして、検証専用 Discord guild/channel/user/organizer role を束縛した
テスト専用 IAM fixture を `/home/gdgagent-svc/.config/xangi/iam.json` (`0600`, service-user ownership)
に配置する必要がある。production IAM、Discord token、account link、wiki credential は VM に持ち込まない。

Use `agents-local/dev/seed-iam.sh` to install the committed, fully synthetic fixture
(`agents-local/dev/iam-fixture.json` — readable placeholder ids such as `test-guild` and
`role-organizer`, not real Discord snowflakes; nothing on the harness path validates or resolves
IDs, so synthetic ids exercise the same code as real ones), then follow
[`iam-e2e-runbook.md`](iam-e2e-runbook.md). Seeding is deliberately between `provision.sh` and
`activate.sh`: IAM is read only at xangi startup.

Check 4 needs a chapter-restricted specimen, but the VM wiki corpus has none — all 484 pages are
`visibility: member` with no `chapter_id`. `seed-iam.sh` therefore also drops a local-only
`pages/test-chapter-restricted/page.md` into the cloned wiki, excluded via `.git/info/exclude` so it is
never committed or pushed and production wiki content is never touched.

fixture 投入後、以下を確認するまで IAM/authz、nonce/slot/preToolUse、`wk` fallback、sandboxed ingest の
本番相当 E2E は未完了とする。

1. organizer role の allow path が permission class を解決し、nonce/slot を発行して `wk read` 経由で回答する。
2. 同一 guild/channel の role なし deny path が Cursor process、nonce、slot を生成しない。
3. chapter をまたぐ role/channel の組合せが IAM channel policy に従って拒否される。
4. `gdg-jp/agents` と source visibility の結果が national と chapter-restricted の各 1 件で一致する。
