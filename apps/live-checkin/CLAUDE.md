@AGENTS.md

# プロジェクト概要
Next.js (App Router) + TypeScript + Tailwind CSS を使用した Web アプリケーション。

# 主要なコマンド
- 開発サーバー起動: `pnpm --filter @gdgjp/live-checkin dev`
- ビルド: `pnpm --filter @gdgjp/live-checkin build`
- 型チェック: `pnpm --filter @gdgjp/live-checkin typecheck`
- リント: ルートで `pnpm lint`（Biome）

# コード規約・設計ポリシー
- **言語/スタイル**: TypeScript (Strict Mode) / コンポーネントは原則 Functional Component とする。
- **スタイリング**: Tailwind CSS を使用する。
- **ディレクトリ構成**: 
  - ページ・ルーティング: `app/`
  - 共通コンポーネント: `components/` (存在する場合)
  - ユーティリティ/共通関数: 必要に応じて適切な TS ファイルに配置

# Claude Code への行動指示
- **レスポンス**: 日本語で分かりやすく簡潔に回答すること。
- **コード生成/修正**: 
  - 大きな変更を行う前に、まず方針（Plan）を提示して確認をとること。
  - 存在しないライブラリを勝手に `pnpm add` しないこと。
  - 変更後は必要に応じて `pnpm tsc` や `pnpm --filter @gdgjp/live-checkin build` を実行し、型エラーやビルドエラーが出ないか確認すること。