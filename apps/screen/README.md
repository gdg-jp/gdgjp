# screen.gdgs.jp

登壇者のカメラ・マイク・画面共有を OBS の Browser Source に取り込み、配信担当が登壇者へ音声・映像・カンペで指示するアプリ。
メディアは Cloudflare Realtime（Serverless SFU）を経由する。

- 配信担当: `https://screen.gdgs.jp/`（GDG チャプターメンバーのみ）。ステージを作り、コントロールルームで登壇者を出力枠 A〜D に割り当てる。
- 登壇者: ステージの招待リンク `https://screen.gdgs.jp/<英単語3つ>/`（ログイン不要）。待機室で機材を確認して参加する。
- OBS: 出力枠ごとに 3 つの Browser Source（カメラ・画面・マイク）。URL はコントロールルーム右上の 📺 からコピーする。

## OBS の設定

1. ソース ＋ →「ブラウザ」→ URL を貼り付け、幅 1920・高さ 1080。
2. 「OBS で音声を制御する」を **ON**。
3. 「表示されていないときにソースをシャットダウン」を **OFF**。

未割り当ての枠は透明。登壇者の回線が切れても最後のフレームを 10 秒保持し、復帰すると自動で再接続する。
OBS URL を再発行すると古い URL は即座に無効になる。本番中は再発行しないこと。

## 開発

```sh
cp .dev.vars.example .dev.vars   # REALTIME_APP_ID / REALTIME_APP_TOKEN は実際の SFU アプリの値
pnpm --filter @gdgjp/screen migrate:local
pnpm --filter @gdgjp/screen dev        # http://localhost:5188/dev/login
pnpm --filter @gdgjp/screen test
pnpm --filter @gdgjp/screen test:e2e   # 偽カメラ・マイクで実 SFU を通す（.dev.vars の認証情報が必要）
```

本番の秘密情報は `wrangler secret put` で設定する: `RP_SESSION_SECRET`, `IDP_CLIENT_SECRET`
（accounts 側の `SCREEN_CLIENT_SECRET` と同じ値）, `REALTIME_APP_TOKEN`。
