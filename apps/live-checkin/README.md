# @gdgjp/live-checkin

connpass イベントの受付で、参加者の QR コードを読み取ってチェックインするためのウェブアプリです。
GDG Accounts（OIDC）でログインし、`gdg-kwansai` チャプターに所属するユーザーだけが `/checkin` を利用できます。

Next.js (App Router) + Tailwind CSS v4 + NextAuth.js (Auth.js v5) で構築し、
[OpenNext for Cloudflare](https://opennext.js.org/cloudflare) 経由で Cloudflare Workers にデプロイします。

## 環境変数

`.dev.vars.example` を `.dev.vars`（`preview` 用）および `.env.local`（`dev` 用）にコピーして設定します。

| 変数 | 説明 |
| --- | --- |
| `GDG_CLIENT_ID` | GDG Accounts で発行した OIDC クライアント ID |
| `GDG_CLIENT_SECRET` | 同クライアントシークレット |
| `AUTH_SECRET` | NextAuth のセッション暗号化キー（`npx auth secret` などで生成） |
| `AUTH_URL` | アプリの公開 URL（ローカルでは `http://localhost:3000`） |

## 開発

モノレポのルートで依存関係をインストールしてから実行します。

```sh
pnpm install
pnpm --filter @gdgjp/live-checkin dev
```

<http://localhost:3000> を開きます。

## 型チェック・ビルド

```sh
pnpm --filter @gdgjp/live-checkin typecheck
pnpm --filter @gdgjp/live-checkin build
```

Lint / フォーマットはルートの Biome で実行します（`pnpm lint`）。

## デプロイ

`main` への push 時に `.github/workflows/deploy.yml` が Cloudflare Workers（`gdgjp-live-checkin`）へ自動デプロイします。
手動で行う場合:

```sh
pnpm --filter @gdgjp/live-checkin run deploy
```

初回は Worker にシークレットを登録します。

```sh
pnpm --filter @gdgjp/live-checkin exec wrangler secret put GDG_CLIENT_ID
pnpm --filter @gdgjp/live-checkin exec wrangler secret put GDG_CLIENT_SECRET
pnpm --filter @gdgjp/live-checkin exec wrangler secret put AUTH_SECRET
pnpm --filter @gdgjp/live-checkin exec wrangler secret put AUTH_URL
```

ローカルで Workers ランタイムを使って確認するには `pnpm --filter @gdgjp/live-checkin preview` を使います。

## ライセンス

[LICENSE](./LICENSE) を参照してください。
