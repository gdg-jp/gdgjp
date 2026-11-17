# Plans

ここは設計案、段階的な作業計画、残作業の入口です。実装の正本は各アプリの
`ARCHITECTURE.md` とコードです。以下の状態は各文書の記載に基づき、実装の再監査結果ではありません。

| 計画 | 状態の根拠・注意 |
| --- | --- |
| [Engineering foundations](engineering-foundations/README.md) | CI・検証基盤の改善と、未実施のアプリ別整理 |
| [Knowledge platform v2](knowledge-platform-v2/00-overview.md) | 冒頭の未着手表示とコードの存在に差があります。段階別状態は要確認 |
| [PR application](pr/00-overview.md) | 機能仕様と段階計画。アプリは存在しますが、全段階完了とは扱いません |
| [Local agents MVP](agents-local-mvp/index.md) | [Todos](agents-local-mvp/todos.md) に未完項目があります |
| [Local agents refactoring](agents-local-refactoring/index.md) | [Tasks](agents-local-refactoring/tasks.md) に実走・撤去などの未完項目があります |
| [Local agents Workspace integration](agents-local-gws/plan.md) | 段階計画と不具合対応記録。完了状態は個別文書を確認してください |
| [Local agents observability](agents-local-o11y/plan.md) | 拡張計画を含みます。完了の全体確認は未実施です |
| [Local agents testing](agents-local-testing/index.md) | IAM E2E の未完事項と実行手順 |
| [CLI support for URL, Img, SNS](cli-support-url-img-sns/index.md) | [Todos](cli-support-url-img-sns/todos.md) に未完項目があります |
| [Image optimization](image-flux-like-optimization/plan.md) | 提案。完了の全体確認は未実施です |
| [Wiki UI migration](wiki-ui-migration/index.md) | [Status](wiki-ui-migration/status.md) に段階別の未完事項があります |
| [Wiki management UI refinement](wiki-manage-ui-refinement/index.md) | 段階計画。完了の全体確認は未実施です |
| [Wiki refactoring](wiki-refactoring/index.md) | 構造移行計画。現行規約としての参照はアプリ内の設計資料と照合してください |
| [Knowledge platform v1](knowledge-platform-v1/00-llm-wiki-overview.md) | 大半は v2 に置換済み。ACL Stage 09〜10 と [bootstrap 用本文](knowledge-platform-v1/03a-agents-md.md) は現在も参照されます |

Roster の段階計画と ADR は [仕様の入口](../roster/index.md) に維持しています。
古い計画を移動・削除する前に、コード・テストが仕様として読み込んでいないか確認してください。
