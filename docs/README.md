# Documentation

目的から読み始めてください。

| 調べたいこと | 入口 |
| --- | --- |
| アプリの役割・サービス・所有箇所 | [Application map](applications.md)。各アプリの `AGENTS.md` と `ARCHITECTURE.md` が実装の正本です |
| セットアップや運用の手順 | [Guides](guides/README.md) |
| アプリ共通の構造・仕様 | [References](references/README.md) |
| コーディング方針と検証方法 | [Engineering](engineering/README.md) |
| 作業計画と残作業 | [Plans](plans/README.md) |
| 記録済みの不具合 | [Issues](issues/README.md) |
| 過去の検証結果・移行報告・記事 | [Archive](archive/README.md) |

計画に書かれた設計や、過去の成功ログを現在の実装・検証結果として扱わないでください。
計画の完了状態は、各計画の進捗資料を確認してください。今回の整理はファイルの配置と参照を
変更するもので、全サービスの運用手順や計画の実装状況を再検証したものではありません。

次の2箇所はコードが参照する仕様・データを含むため、位置を維持しています。

- [Roster specification](roster/index.md): ADR、型、ソルバー、E2E が参照する仕様。
- [Eval](eval/README.md): 実行用 QA と fixture。`fixtures/push.sh` は外部への書き込みを行います。

エージェントの手順は [`.agents/docs/pstack.md`](../.agents/docs/pstack.md)、
各アプリ固有の構造はアプリ内の `ARCHITECTURE.md` に置きます。
資料を追加・移動したら `pnpm check:docs` で配置とローカルファイルリンクを確認してください。
この検査は外部 URL、見出しアンカー、過去記録の本文を検証しません。
