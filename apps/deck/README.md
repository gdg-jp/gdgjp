# deck.gdgs.jp

Stream Deck Mobile の代わりに、スマホから OBS を操作するアプリ。
スマホと PC は同じ LAN にいなくてよい（どちらも deck.gdgs.jp に繋ぐ）。

- 編集（PC）: `https://deck.gdgs.jp/` → デッキの「編集」。キーの配置・操作・見た目を決めて保存する（GDG チャプターメンバーのみ）。
- 操作（スマホ）: `https://deck.gdgs.jp/d/<deck>`。ホーム画面に追加すると全画面で開ける。デッキの配置はスマホからは変えられない。
- OBS: 編集画面のメニュー →「OBS のドック URL」を、OBS の「ドック」→「カスタムブラウザドック」に貼る。

## OBS の設定

1. OBS の「ツール」→「WebSocket サーバー設定」で「WebSocket サーバーを有効にする」を ON にし、パスワードを決める。
2. 「ドック」→「カスタムブラウザドック」にドックの URL を追加する。
3. ドックの「設定」で obs-websocket の URL（既定 `ws://127.0.0.1:4455`）とパスワードを入れる。スクリーンショットのキーを使うなら保存先フォルダも入れる。

パスワードはその PC のドックにだけ保存され、deck.gdgs.jp には送られない。
ドックの URL を再発行すると古い URL は即座に無効になる。本番中は再発行しないこと。

1 デッキ = 1 OBS。OBS が複数台なら、デッキを複製してそれぞれのドックを設定する。

## 開発

```sh
cp .dev.vars.example .dev.vars
pnpm --filter @gdgjp/deck migrate:local
pnpm --filter @gdgjp/deck dev        # http://localhost:5189/dev/login?chapter=1:dev-chapter
pnpm --filter @gdgjp/deck test
pnpm --filter @gdgjp/deck test:e2e   # 偽の obs-websocket（e2e/fake-obs.ts）を相手に全経路を通す
node apps/deck/e2e/fake-obs.ts 4466 secret   # 手で試すときの偽 OBS
```

本番の秘密情報は `wrangler secret put` で設定する: `RP_SESSION_SECRET`, `IDP_CLIENT_SECRET`
（accounts 側の `DECK_CLIENT_SECRET` と同じ値）。
初回デプロイ前に `wrangler d1 create gdgjp-deck-db` と `wrangler r2 bucket create gdgjp-deck-images` を実行し、
`wrangler.toml` の `database_id` を置き換える。
