# ADR — discord-relay

要求分析は [`docs/rdra/discord-relay/`](../rdra/discord-relay/overview.md) にある。
ここにあるのは **なぜその実現方式にしたか、何を却下したか** である。

RDRA が「技術スタック検討時に決定する」と明示的に先送りした論点
（[`auth.md` §Plane 間認証](../rdra/discord-relay/contexts/auth.md)）に、この文書で答える。

`docs/agents-local-mvp/adr.md` の規約に倣い、1 ファイルに連番で記録する。
決定を消さずに、新しい ADR で supersede すること。

| # | 決定 | Status |
|---|---|---|
| [001](#adr-001-data-plane-を-gateway-転送専用に絞り配信を-control-plane-に寄せる) | Data Plane を Gateway 転送専用に絞り、配信を Control Plane に寄せる | Accepted |
| [002](#adr-002-plane-間通信をアウトバウンド片方向に限定しoci-にインバウンド経路を作らない) | Plane 間通信をアウトバウンド片方向に限定する | Accepted |
| [003](#adr-003-設定は-etag-付き-pull-で配り最後に成功した設定をディスクに残す) | 設定は ETag 付き pull、最後の設定をディスクに残す | Accepted |
| [004](#adr-004-tick-エンドポイント-1-本に-heartbeatコマンドconfig-バージョンを相乗りさせる) | tick 1 本に heartbeat・コマンド・config バージョンを相乗りさせる | Accepted |
| [005](#adr-005-plane-間認証を-2-鍵ローテーション可能な-bearer-共有シークレットにする) | Plane 間認証は 2 鍵ローテーション可能な Bearer 共有シークレット | Accepted |
| [006](#adr-006-配信基盤に-cloudflare-queues-を採りメタデータは-d1本文は-r2-に置く) | 配信基盤は Cloudflare Queues、メタデータ D1・本文 R2 | Accepted |
| [007](#adr-007-低遅延化の-durable-object-ハブは-stage-2-とし正しさの依存にしない) | 低遅延化の Durable Object ハブは Stage 2、正しさの依存にしない | Accepted |
| [008](#adr-008-data-plane-を専用の-oci-a1flex-インスタンスに置きagent-host-に相乗りさせない) | Data Plane は専用の OCI A1.Flex（arm64）1 台。agent-host に相乗りしない | Accepted |
| [009](#adr-009-data-plane-を-go-で実装し単一の静的バイナリとして配る) | Data Plane は Go の単一静的バイナリ。Discord ライブラリを使わない | Accepted |
| [010](#adr-010-systemd-の-system-unit-で常駐させ状態は-statedirectory秘密は-loadcredential-に置く) | systemd system unit・StateDirectory・LoadCredential で常駐させる | Accepted |
| [011](#adr-011-デプロイをピン留めした静的バイナリの-pull-型収束としtick-経路をコード配布に使わない) | デプロイはピン留め済みバイナリの pull 型収束。tick をコード配布に使わない | Accepted |

**ADR-001 は RDRA の Plane 分割表と BIZ-004 の担当を書き換える。**
2026-09-05 に採用が確定し、末尾の[「RDRA への影響」](#rdra-への影響)に挙げた更新は適用済みである。

---

## ADR-001: Data Plane を Gateway 転送専用に絞り、配信を Control Plane に寄せる

### Status

Accepted

### Date

2026-09-05

### Context

RDRA の Plane 分割表（[overview.md §Plane 分割](../rdra/discord-relay/overview.md)）は、
Data Plane (OCI) に以下すべてを割り当てている。

> Gateway 接続、ルール評価、永続キュー、配信、リトライ、DLQ、配信ログの SSoT

しかしユーザーが実際に下した決定は **「分割：画面=Workers / 接続=OCI」** であり、
*接続* を OCI に置くとは言っているが、*配信* を OCI に置くとは言っていない。
RDRA 側で配信まで DP に寄せたのは分析時の暫定であり、ここで正面から見直す。

境界の位置を決めるにあたって効く事実は 4 つある。

1. **Workers が持てないのは長寿命の WebSocket クライアントだけである。**
   Gateway 接続は Workers では成立しない。しかし HTTP POST の送出、リトライ、キューイングは
   Workers が最も得意とする領域であり、リポジトリ内に `wiki/`（3 キュー）と `connpass/`（1 キュー）の
   運用実績がある。

2. **SSRF の危険度が Plane によって桁違いに異なる。**
   RDRA が SSRF ガードを必須要件に格上げした直接の理由は、OCI VM から
   インスタンスメタデータ `169.254.169.254` に到達できることである
   （[rule-management.md](../rdra/discord-relay/contexts/rule-management.md) の SSRF ガード表、
   [event-delivery.md](../rdra/discord-relay/contexts/event-delivery.md) COND-404）。
   Cloudflare のネットワークから出る `fetch` には、そもそもその宛先が経路上に存在しない。

3. **秘匿情報の保管場所が Plane 責務で決まる。**
   DP が配信するなら、DP は **全チャプターの署名シークレットと、配信先のカスタムヘッダ**
   （n8n / Slack / GAS のトークンが入る）を保持しなければならない。
   DP が転送専用なら、DP が持つ秘密は **Discord Bot トークン 1 つだけ**になる。
   DP は GDG ボランティアが運用する無料枠 VM である。

4. **DP のコード量と運用リスクの大半は配信側にある。**
   永続キュー、バックオフスケジューラ、DLQ、保持期間バッチ、宛先別レート制限 —
   これらを 1 OCPU / 1 GB のインスタンスで自作し、監視も自作することになる。

### Decision

**Plane の境界を「Gateway セッションを保持できるか」の一点だけで引く。**

| Plane | パッケージ | 責務 |
|---|---|---|
| Data Plane | `discord-relay-gateway/` (OCI) | Gateway 接続・RESUME・**粗いフィルタ**・転送バッファ・Control Plane への転送 |
| Control Plane | `discord-relay/` (Workers) | ダッシュボード、OIDC RP、設定 SSoT、**ルール評価・正規化・キュー・配信・リトライ・DLQ・ログ SSoT** |

**DP が持つ設定は「粗いフィルタ」だけにする。**

```jsonc
// GET /api/dp/config が返す購読仕様（秘匿値を一切含まない）
{
  "version": 1234,
  "intents": ["GUILDS", "GUILD_MESSAGES", "MESSAGE_CONTENT"],
  "subscriptions": [
    { "guild_id": "123456789012345678", "event_types": ["MESSAGE_CREATE", "GUILD_MEMBER_ADD"] }
  ]
}
```

- 登録済みギルド **かつ** 誰かが購読しているイベント種別だけを転送する。それ以外は DP で捨てる。
- チャンネル・投稿者・キーワードといった細かいフィルタ、配信先 URL、署名シークレット、
  カスタムヘッダは **DP に一切渡さない**。すべて Control Plane で評価・保持する。
- 結果として **DP は GDG のチャプターという概念を知らない。**

RDRA が BIZ-004 の設計注意として挙げた「購読者のいないイベントをキューに入れない」という
負荷対策は失われない。キューに入るのは依然としてマッチしたものだけで、
ネットワークを渡るのが「登録ギルドの購読種別のイベント」に変わるだけである。

### Alternatives Considered

**A. RDRA どおり DP に配信まで持たせる（fat DP）**

- Pros: Control Plane が落ちても配信が継続する。イベントがネットワークを渡らない
- Cons: SSRF ガードが構造的でなく実装依存になる。無料枠 VM が全チャプターの
  署名シークレットと配信先トークンの保管庫になる。キュー・DLQ・保持期間バッチを自作する
- Rejected: 上記 Context 2 と 3。とくに 3 は、侵害されたときの被害範囲が
  「Discord Bot トークン」から「全チャプターの外部連携資格情報」に広がる。
  無料枠 VM 1 台に対して引き受ける代償として釣り合わない

**B. Durable Object に Gateway WebSocket を持たせ、OCI を使わない（全 Cloudflare）**

- Pros: OCI の運用が消える。Plane 分割そのものが不要になる
- Cons: DO の **アウトバウンド** 長寿命 WebSocket は hibernation API の対象外で、
  接続中は常時課金対象として起き続ける。DO はデプロイやインフラ都合で任意に退避されうるため、
  再起動のたびに IDENTIFY を消費する。Discord の IDENTIFY は 1 日 1000 回・
  同時 1 セッションの制限があり、退避頻度が読めない構成でここを賭けたくない
- Rejected: サポートされたパターンではない。ただし **OCI が使えなくなった場合の逃げ道**
  として記録しておく。その時点で再検討する

**C. DP が全イベントを無条件に転送し、フィルタも Control Plane に寄せる**

- Pros: DP から設定という概念が完全に消える。`GET /config` すら要らなくなる
- Cons: `MESSAGE_CONTENT` を有効にした賑やかな GDG サーバーでは、
  マッチしないメッセージまで全件が Worker 呼び出しになる
- Rejected: 粗いフィルタ（ギルド + イベント種別）は秘匿値を含まないため、
  DP に置いてもリスクを増やさない。ただ乗せるだけで大半を落とせる以上、置かない理由がない

### Consequences

- **SSRF ガードの性質が変わる。** COND-404 の要件は残すが、
  「実装が正しくないと危険」から「多層防御の 1 枚目」に格下げされる。
  ただし Cloudflare がプライベート宛先への到達不能を**セキュリティ保証として文書化しているわけではない**
  ため、宛先スキーム・ポート・解決結果の検査は引き続き実装する。
- **DP が保持する秘密が Discord Bot トークン 1 つになる。** OCI VM の侵害時に
  外部連携資格情報が漏れない。
- **Control Plane が落ちると配信が止まる。** fat DP に対する明確な後退。
  ADR-003 の「最後の設定をディスクに残す」は Gateway 接続の維持には効くが、配信は止まる。
  Cloudflare の可用性を無料枠 VM のそれより高いと見なす、という賭けを明示的に受け入れる。
- **`discord-relay-gateway/` は pnpm ワークスペースにしない。** OCI で動く Node プロセスであり、
  Workers アプリではない。`cli/` が pnpm ワークスペースでないのと同じ扱いにする。
- RDRA の BIZ-004 の担当が DP から CP に移る。末尾の影響表を参照。

---

## ADR-002: Plane 間通信をアウトバウンド片方向に限定し、OCI にインバウンド経路を作らない

### Status

Accepted

### Date

2026-09-05

### Context

RDRA は REQ-602 で「OCI 側のエンドポイントはインターネットに直接露出しない」と要求し、
実現方式として **Cloudflare Tunnel + Access のサービストークン、または共有シークレット / mTLS**
を候補に挙げたまま先送りしていた（[auth.md §Plane 間認証](../rdra/discord-relay/contexts/auth.md)）。

Tunnel を張るということは、**インバウンド経路が存在し、それを認証で守っている**状態である。
守り方の巧拙にかかわらず、設定ミス 1 つで露出する構成になる。
経路そのものを作らずに済むなら、そちらのほうが強い。

CP → DP に必要なやりとりを数えると、以下の 4 つしかない。

| 用途 | 頻度 | 同期性 |
|---|---|---|
| 設定変更の伝播 | 稀 | 結果整合でよい |
| コマンド送出（テスト配信・手動再送・再接続指示） | 稀 | 対話的、数秒以内に結果が欲しい |
| 接続状態の取得 | 常時 | 数秒の遅延は許容 |
| ライブイベントの取得 | 閲覧中のみ | 数秒の遅延は許容 |

**いずれも「DP が定期的に問い合わせ、応答に相乗りさせる」で成立する。**

### Decision

**Plane 間の TCP 接続は、常に DP から CP へ張る。CP から DP への経路は作らない。**

- Cloudflare Tunnel を使わない。OCI のセキュリティリストは全 ingress を閉じる（SSH を除く）。
- CP → DP の情報は、すべて **DP からの要求に対する応答**として返す（ADR-004）。
- ADR-007 の Durable Object ハブを導入する場合も、WebSocket は **DP 側から** 張る。

REQ-602 は「露出しない設定にする」ではなく **「露出する経路が存在しない」** で満たされる。

### Alternatives Considered

**A. Cloudflare Tunnel + Access サービストークン**

- Pros: CP から DP を即座に叩ける。コマンドの遅延がゼロになる
- Cons: `cloudflared` の常駐が増える。Access のポリシー設定が正しいことに安全性が依存する。
  CP は Workers なので、DP がダウンしている間の再送を自前のキューで持つ必要がある
- Rejected: 得られるのはコマンドの数秒の短縮だけで、それは ADR-007 の
  アウトバウンド WebSocket でも同じだけ得られる。経路を増やす対価に見合わない

**B. mTLS**

- Pros: 共有シークレットより強い
- Cons: インバウンド経路が存在する点は A と変わらない。証明書のローテーションが増える
- Rejected: A と同じ理由

### Consequences

- OCI 側のファイアウォール設定が「全部閉じる」の一行で済む。設定ミスの余地が小さい。
- コマンドの遅延が polling 間隔に律速される（Stage 1 で最大 5 秒、ADR-007 導入後は実質ゼロ）。
- DP のホスト名・IP を CP が知る必要がなくなる。DP を別ホストに移す・一時的に開発機で
  動かすといった操作が、CP 側の設定変更なしに行える。
- **DP の身元は共有シークレットだけで決まる**（ADR-005）。IP 制限のような追加の縛りは掛からない。

---

## ADR-003: 設定は ETag 付き pull で配り、最後に成功した設定をディスクに残す

### Status

Accepted

### Date

2026-09-05

### Context

設定の SSoT は Control Plane の D1 にある。DP はそれを反映して動く。
「反映」の実現方式が pull か push かで、障害時の挙動が変わる。

`docs/agents-local-mvp/adr.md` の [ADR-026](../agents-local-mvp/adr.md) は、
同じ OCI/Ubuntu ホストに対する設定配信について **pull 型** を採っている
（理由は self-hosted runner と ssh デプロイ鍵の危険性）。本件は理由が異なるが、結論は揃う。

### Decision

**1. DP が `GET /api/dp/config` を pull する。ETag / `If-None-Match` で差分がなければ 304。**

**2. 200 を受けた設定を、必ずローカルディスクに書いてから適用する。**

起動時は「ディスクの設定で先に Gateway へ繋ぎ、その後 CP に問い合わせる」順序にする。
これをやらないと **CP 障害中に DP が再起動した瞬間、全チャプターが完全停止する**。

**3. 設定の反映は種別で扱いを変える。**

| 変更 | 反映方法 |
|---|---|
| `subscriptions` の増減 | ホットリロード。再接続しない |
| `intents` の変更 | **プロセス再起動**（COND-102 が要求する。IDENTIFY をやり直す必要がある） |

`intents` の変更は Gateway セッションを切るため、反映を自動で行わず
**次の再起動まで保留するか、管理者が明示的に再起動コマンドを送るか**を選べるようにする
（コマンドは ADR-004 の経路に乗る）。無断で全チャプターの受信を数秒止めない。

**4. `version` は D1 上の単調増加整数とし、ETag はその値から導出する。**
コンテンツハッシュではなく明示的なバージョンにするのは、ADR-004 の tick 応答で
「今の版は 1234 だ」と伝えるだけで DP に差分の有無を判断させるため。

### Alternatives Considered

**A. CP から DP へ push（設定保存時に通知）**

- Rejected: ADR-002 でインバウンド経路を作らないと決めた。
  加えて、push が失われたときに DP が永久に古い設定で動き続ける経路ができる

**B. 設定を Git リポジトリに置き、DP が `git pull` する（GitOps）**

- Pros: 変更履歴が自然に残る。ADR-026 のピン留めの発想と揃う
- Cons: 設定の書き手がダッシュボードの organizer であり、コミット権限とは無関係。
  ルール 1 つの有効化に PR が要る運用は GOAL-002（ノーコードでの転送設定）を壊す
- Rejected: 設定の主体が人間の開発者ではなくチャプター運営者であるため

### Consequences

- **CP が落ちても Gateway 接続は維持され、DP は最後の設定で動き続ける。**
  ADR-001 で配信は止まるが、受信・バッファリングは続くため、CP 復旧後に流れる
  （バッファ上限までは。ADR-004 参照）。
- 設定変更の反映が最大で tick 間隔ぶん遅れる。organizer には UI で
  「反映待ち」を出す必要がある（RDRA の SCR-30x にこの表示は無いので、追加が要る）。
- ディスク上の設定ファイルは秘匿値を含まない（ADR-001）ため、パーミッションの要求が緩い。

---

## ADR-004: tick エンドポイント 1 本に heartbeat・コマンド・config バージョンを相乗りさせる

### Status

Accepted

### Date

2026-09-05

### Context

ADR-002 で「DP からの要求に相乗りさせる」と決めた結果、DP が回すループの本数が問題になる。
素直に作ると、設定 poll・heartbeat 送信・コマンド poll・テレメトリ送信で 4 本になる。
4 本それぞれにリトライとバックオフを実装するのは無駄で、状態が食い違う。

### Decision

**`POST /api/dp/tick` 1 本にまとめる。** 要求と応答の双方に、必要なものをすべて載せる。

```jsonc
// → DP から CP へ
{
  "instance_id": "oci-a1-01",
  "config_version": 1234,
  "sent_at": "2026-09-05T12:34:56.789Z",
  "heartbeat": {
    "gateway_state": "Ready",        // STATE-001 の状態名をそのまま使う
    "session_id": "abc...",
    "guild_count": 12,
    "buffer_depth": 3,
    "dropped_total": 0,
    "last_event_at": "2026-09-05T12:34:55.001Z"
  },
  "events": [ /* 転送するイベント。ADR-001 の粗いフィルタを通ったもの */ ],
  "command_results": [ { "command_id": "cmd_...", "status": "ok", "detail": {} } ]
}

// ← CP から DP へ
{
  "ack_through": "01JBX8Z9K2M4N6P8Q0R2S4T6V8",  // ここまでバッファから消してよい
  "config_version": 1234,                        // 差があれば DP は GET /config する
  "commands": [ { "command_id": "cmd_...", "type": "restart", "args": {} } ],
  "live_subscribers": ["123456789012345678"],    // ライブビューアが開いているギルド
  "next_tick_ms": 5000
}
```

**1. `events` は tick に相乗りさせる。専用の転送エンドポイントを作らない。**
イベントが無いときは空配列になり、そのまま heartbeat として機能する。

**2. `ack_through` を受けてから DP がバッファを削る。** at-least-once の受け渡し。
CP 側は `event_id` で冪等に取り込む（`INSERT ... ON CONFLICT DO NOTHING`）。

**3. `next_tick_ms` を CP が返し、DP の間隔を CP 側から制御する。**
既定 5000 ms。イベントが溜まっているときは DP が待たずに即座に次を投げてよい。
ライブビューアが開いていないときは `live_subscribers` が空になり、DP はライブ用の
イベント複製を送らない。

**4. `live_subscribers` に載っていないギルドのイベントも、配信対象なら送る。**
ライブビューアはあくまで「配信されないイベントも見せる」ための追加であり、
これが無いときは購読仕様（ADR-001）を通ったもののうち配信対象だけを送る。

**5. イベント識別子を 2 本立てにする。**

RDRA の [event-delivery.md](../rdra/discord-relay/contexts/event-delivery.md) は
エンベロープの `id` に ULID を置き、それを `Idempotency-Key` に使うと書いている。
**このままでは `Idempotency-Key` が機能しない。** ULID は生成のたびに変わるため、
Gateway の RESUME で同じ Discord イベントが再配送されたとき、
受信側は別イベントとして扱ってしまう。RESUME による重複を受信側に吸収させるという
設計意図（同ファイル「`Idempotency-Key` は必須の設計要素である」）と矛盾する。

したがって:

| 識別子 | 生成 | 用途 |
|---|---|---|
| `event_id` | DP が受信時に ULID を採番 | 転送リトライの冪等キー、順序、`ack_through` |
| `dedupe_key` | `sha256(event_type ‖ canonical_json(d))` | RESUME 再配送の同一性判定 |
| エンベロープ `id` | `sha256(dedupe_key ‖ rule_id)` を ULID 形式に整形 | `Idempotency-Key`。**同一イベント×同一ルールで常に同じ値** |

`canonical_json` はキーを再帰的にソートし空白を除いたもの。
Discord が再配送時にフィールドを変えないことに依存する best-effort であり、
完全な重複排除は保証しない — **`Idempotency-Key` は受信側の冪等性を助けるためのもので、
本アプリが exactly-once を主張するものではない**（RDRA の at-least-once 方針は不変）。

**6. 転送バッファの上限超過は、イベント種別で優先度を付けて捨てる。**
RDRA の COND-403 / UC-408（キュー上限とバックプレッシャ）は、ADR-001 によって
「DP の転送バッファ」と「CP の Queues」の 2 箇所に分かれる。DP 側の規則:

1. まず `live_subscribers` 向けの複製を捨てる（見えなくなるだけ）
2. 次に古いイベントから捨てる
3. 捨てた件数を `dropped_total` に積み、tick で必ず CP に報告する（**黙って捨てない**）

### Alternatives Considered

**A. 用途ごとにエンドポイントを分ける（`/config` `/events` `/heartbeat` `/commands`）**

- Pros: 各エンドポイントの責務が明快。REST として素直
- Cons: DP 側にループが 4 本、リトライが 4 系統。CP 側は Worker 呼び出しが 4 倍
- Rejected: `GET /config` だけは分けた（ETag が効くのと、頻度が桁違いに低いため）。
  残り 3 つは同じ周期で回るので分ける理由がない

**B. コマンドをロングポーリングで即時化する（`GET /commands?wait=25`）**

- Pros: インバウンド経路なしでコマンドが即時になる
- Cons: Worker が 25 秒間 D1 をポーリングし続けることになる。
  即時性が欲しいなら ADR-007 の Durable Object のほうが素直
- Rejected: ADR-007 に寄せる

### Consequences

- DP のネットワーク層が 1 本になる。リトライ・バックオフ・タイムアウトの実装が 1 箇所。
- Worker 呼び出しは常時 5 秒に 1 回（約 52 万回/月）。Workers の課金上は無視できる量。
- **CP が落ちている間、DP はバッファを積み続ける。** 上限に達すると捨てる。
  「CP 障害が何分続いたらイベントを失い始めるか」が、バッファ上限とイベント流量で決まる
  設計パラメータになる。これは監視すべき値であり、初期値の決定は実装時の宿題とする。
- ADR-007 を入れると `next_tick_ms` を 30000 まで伸ばせる。tick は heartbeat 兼
  取りこぼしの受け皿として残す。

---

## ADR-005: Plane 間認証を 2 鍵ローテーション可能な Bearer 共有シークレットにする

### Status

Accepted

### Date

2026-09-05

### Context

ADR-002 の結果、認証すべき経路は **DP → CP の 1 方向だけ** になった。
主体は 1 プロセス・1 アイデンティティで、GDG が運用する。

RDRA が候補に挙げた mTLS と Cloudflare Access サービストークンは、いずれも
「複数の主体を中央で識別・失効する」ための道具である。主体が 1 つの現時点では
その利得が出ない。一方で漏洩時の被害は方式によらず同じ（全チャプターの設定閲覧と
偽のテレメトリ投入）なので、**失効と交換が確実にできること**を要件に据える。

### Decision

**`Authorization: Bearer <secret>` で認証し、Worker 側で定時比較する。**

1. **鍵は常に 2 つ受け付ける。** `DP_SHARED_SECRET_CURRENT` と `DP_SHARED_SECRET_PREVIOUS`。
   ローテーション手順は「CP に新旧両方を置く → DP を新に切り替える → CP から旧を消す」。
   DP を止めずに交換できる形にしておく。
2. **比較は定時比較にする。** 長さの差で早期 return しない。
3. `/api/dp/*` 以外にこの認証を掛けない。ダッシュボードの認証（OIDC）とは完全に別系統。
4. Cloudflare 側でこのパスにレート制限を掛ける。
5. **秘密は環境変数として渡す。** CP は `wrangler secret put`、DP は systemd の
   `EnvironmentFile`（mode 0600、`root:root`）。リポジトリには `.dev.vars.example` と
   `.env.example` にキー名だけを置く。

### Alternatives Considered

**A. Cloudflare Access サービストークン**

- Pros: 失効が Zero Trust ダッシュボードから即座にできる。アクセスログが残る
- Cons: Zero Trust の設定が増える。Worker 側で Access JWT の検証が必要
- Rejected: 主体が 1 つの間は利得が出ない。**ただし昇格条件を明示する** —
  DP が 2 台目になる、または DP を GDG 以外が運用する事態になったら、この方式に切り替える

**B. mTLS**

- Rejected: A と同じ理由に加え、証明書運用が増える

**C. HMAC 署名（リクエストボディに署名し、リプレイ防止に timestamp を含める）**

- Pros: 秘密そのものが線上を流れない
- Cons: TLS 上で Bearer を流すのとの差が、実質「Cloudflare のログに秘密が残らない」点だけ
- Rejected: 対価に見合わない。**ただし配信先への署名（UC-405）とは別の話であり、
  そちらは HMAC のまま**

### Consequences

- DP のホストが侵害されると、攻撃者は全チャプターの購読仕様を読め、
  偽のテレメトリと偽の `command_results` を投入できる。
  **ADR-001 の結果、配信先 URL・署名シークレット・カスタムヘッダは読めない。**
- 偽テレメトリの影響を限定するため、CP は tick の `events` を無条件に信用しない:
  `guild_id` が購読仕様に載っていないイベントは捨てる。
- 鍵の交換手順を運用ドキュメントに残す必要がある（SETUP タスクに追加）。

---

## ADR-006: 配信基盤に Cloudflare Queues を採り、メタデータは D1・本文は R2 に置く

### Status

Accepted（ADR-001 に従属する）

### Date

2026-09-05

### Context

ADR-001 で配信が Control Plane に移ると、RDRA の STATE-003（Queued → InFlight → Delivered /
Retrying / DeadLettered / Dropped）を Workers の上で実現することになる。

リポジトリには Cloudflare Queues の実績が既にある（`wiki/` 3 本、`connpass/` 1 本）が、
**DLQ を設定している例はまだ無い**（`grep dead_letter_queue` が空）。ここで初めて使う。

もう 1 つの論点は、配信履歴の実体をどこに置くかである。RDRA は DP を SSoT としているが、
ADR-001 でそれが崩れる。改めて考えると、SCR-502（配信履歴）と SCR-503（DLQ 一覧）は
**「Data Plane が落ちている」という最も見たい障害のときにこそ開かれる画面**であり、
参照先が DP にあるとその瞬間に何も見えなくなる。

### Decision

**1. 配信キューは Cloudflare Queues。**

```toml
[[queues.producers]]
binding = "DELIVERY_QUEUE"
queue = "gdgjp-discord-relay-deliveries"

[[queues.consumers]]
queue = "gdgjp-discord-relay-deliveries"
max_batch_size = 1          # 宛先ごとに独立して失敗させたい
max_batch_timeout = 5
max_retries = 6             # VAR-402 の 6 段に合わせる
dead_letter_queue = "gdgjp-discord-relay-dlq"
```

- STATE-003 のバックオフ（VAR-402: 1s → 5s → 30s → 2m → 10m → 30m）は
  `message.retry({ delaySeconds })` で段ごとに明示指定する。
  429 の `Retry-After` はこの値を上書きする。
- 再試行不能（429 以外の 4xx、COND-402）は `retry()` せず、DLQ キューへ明示的に送る。

**2. ルール評価は tick ハンドラの中で同期的に行い、マッチしたものだけを enqueue する。**

`POST /api/dp/tick` の処理順は「認証 → 購読仕様との突合 → ルール評価 → enqueue（await）→ 200」。
200 を返した時点で enqueue が完了していることを保証する（ADR-004 の `ack_through` の前提）。
ルールセットは `config_version` をキーにモジュールスコープでキャッシュし、D1 を毎回叩かない。

**3. 配信履歴はメタデータと本文を分ける。**

| 対象 | 置き場 | 理由 |
|---|---|---|
| INFO-008 DeliveryAttempt のメタ（ルール、結果種別、ステータス、所要時間、試行回数、時刻） | **D1** | 一覧・絞り込み・集計の対象。小さく、索引が要る |
| INFO-007 の生ペイロード、リクエスト/レスポンス本文 | **R2** | 大きい。1 件詳細を開いたときにしか読まない |
| INFO-009 DeadLetter | D1（メタ）+ R2（本文） | 上に同じ |

- COND-503（ペイロード非保存ルール）では R2 に書かない。D1 のメタだけ残す。
- VAR-502 の保持期間は **R2 のライフサイクルルール** と **Cron Trigger による D1 の削除**の
  2 系統で実施する。片方だけだと孤児が残る。

**4. Queues のメッセージにはポインタだけを載せ、本文は載せない。**
Queues の 1 メッセージ上限は 128 KB で、embed の多い Discord イベントは近づきうる。
イベント本文は tick 受信時に R2 へ書き、キューには `{ event_ref, rule_id, attempt }` を入れる。

### Alternatives Considered

**A. 配信履歴を DP のローカル SQLite に置き、CP は必要時に問い合わせる**

- Pros: 重複が無い。書き手が 1 つ
- Cons: **DP 障害時にダッシュボードが空になる。** 障害調査に使えない。
  ADR-002 でインバウンド経路を作らないと決めたため、そもそも CP から問い合わせられない
- Rejected: ADR-002 と両立しない

**B. メタも本文もすべて D1 に入れる**

- Pros: 実装が 1 箇所で済む。R2 のライフサイクル設定が不要
- Cons: D1 に大きな BLOB が積み上がる。一覧クエリの性能が本文の重さに引きずられる
- Rejected: 分けるコストが小さく、利得が明確

**C. Queues を使わず、D1 にキューテーブルを作って Cron Trigger で回す**

- Pros: DLQ も再送も同じテーブルで完結し、SQL で自在に見られる
- Cons: Cron Trigger の最小粒度は 1 分。VAR-402 の 1s / 5s の段が表現できない。
  並列度の制御を自作することになる
- Rejected: バックオフの段が要件（VAR-402）である以上、分単位の粒度では足りない

### Consequences

- リポジトリ初の Queues DLQ 利用になる。DLQ 側にも consumer を置き、
  D1 の `dead_letters` に記録して SCR-503 に出す。
- **宛先ごとのレート制限は best-effort になる。** Queues は宛先キーごとの
  順序保証や同時実行制御を持たない。当面は 429 の `Retry-After` 尊重で凌ぎ、
  必要になったら宛先ごとの Durable Object を挟む（RDRA の UC-404 が要求する
  「宛先ごとのレート制限を守りながら送信する」は、この範囲での達成にとどまる）。
- **手動再送（UC-504）は D1 の記録から新しいメッセージを作って enqueue するだけ**になり、
  DP へのコマンドが不要になる。ADR-004 の `commands` に載るのは
  「再接続」「Intent 変更の適用」など Gateway 由来のものだけになる。
- **テスト配信（BIZ-003）も Control Plane で完結する。** DP への往復が消えるので、
  ADR-007 を入れる前から結果が即座に返る。ADR-007 の必要性が下がる。

---

## ADR-007: 低遅延化の Durable Object ハブは Stage 2 とし、正しさの依存にしない

### Status

Accepted

### Date

2026-09-05

### Context

ADR-004 の tick（5 秒）で残る遅延は 2 つある。

1. **設定変更の反映**が最大 5 秒 + `GET /config` の往復
2. **ライブイベントビューア（SCR-501）が 5 秒刻みでしか更新されない**

`ost/` が `OstBoard`（SQLite ストレージ + hibernatable WebSocket + `getByName(slug)`）で
同種の問題を解いており、リポジトリ内にパターンがある。

一方で、ADR-006 の結果としてテスト配信も手動再送も Control Plane で完結するため、
**「対話操作が遅い」という当初の懸念は概ね消えている。** 残るのはライブビューアの
体感だけであり、それは機能価値の中心ではない。

### Decision

**Durable Object ハブは Stage 2 として分離し、Stage 1 は tick だけで作る。**

- **Stage 1**: `POST /api/dp/tick`（5 秒）のみ。ライブビューアはブラウザが
  `GET /api/live?since=<cursor>` を 2 秒ポーリングする。実効遅延は最大 7 秒。
- **Stage 2**: 単一の `RelayHub` Durable Object を置く。DP が **アウトバウンドで**
  WebSocket を張り（ADR-002）、ブラウザは hibernatable WebSocket で同じ DO に繋ぐ。
  DO はチャプター境界でフィルタして配信する。tick は 30 秒間隔の heartbeat 兼
  取りこぼしの受け皿として残す。

**設計規則: DO チャネルが死んでいても、システムは正しく動き続けなければならない。**

- 設定は DO 経由で配らない。DO は「版が変わった」と伝えるだけで、実体は常に
  `GET /config`（ADR-003）から取る。
- イベントの受け渡しは DO を正としない。DO が落ちていれば tick に載る。
  `ack_through` の権威は tick 側にある。
- DO が落ちたときの劣化は「反映とライブビューが 5〜30 秒遅くなる」だけにする。

**ハブは 1 個のシングルトンにする。** DP は D-2 により単一プロセス・単一 Gateway セッションなので、
チャプターごとに DO を分けると DP が N 本の接続を張ることになる。
チャプター境界のフィルタは DO の中で行う。

### Alternatives Considered

**A. Stage 1 から DO を入れる**

- Pros: 作り直しが無い
- Cons: 初回リリースの構成要素が 1 つ増える。ADR-006 によって
  「DO で解決したかった対話遅延」の大半が既に消えている
- Rejected: 段階を分けても Stage 1 の実装が無駄にならない（tick は Stage 2 でも残る）ため、
  分けない理由がない

**B. チャプターごとに DO を分ける**

- Pros: 境界が構造的になる。1 チャプターの負荷が他に影響しない
- Cons: DP が N 本の WebSocket を張る。チャプター増加がそのまま接続数になる
- Rejected: DP がシングルトンである以上、扇形の要は 1 つが自然

**C. DO を使わず、ライブビューアをブラウザからの SSE にする**

- Cons: Worker が接続を保持できないため、結局 DO が要る
- Rejected: 成立しない

### Consequences

- Stage 1 のライブビューアは「ほぼリアルタイム」であって「リアルタイム」ではない。
  SCR-501 の目的（なぜマッチしなかったかを確かめる）には十分だが、
  UI に更新間隔を明示する。
- Stage 2 の導入判断は、実際に使われてから行える。使われなければ入れなくてよい。
- DO を入れても tick は残る。**2 経路を維持する複雑さ**が Stage 2 の対価である。

---

## ADR-008: Data Plane を専用の OCI A1.Flex インスタンスに置き、agent-host に相乗りさせない

### Status

Accepted

### Date

2026-09-05

### Context

このリポジトリには **すでに常時稼働の自前 Ubuntu ホストがある**。
`agent-host/`（Ubuntu 24.04.3 LTS / x86-64）で、Discord Bot である
[xangi](https://github.com/karaage0703/xangi) と Node サイドカー `langfuse-forwarder` が
systemd で動いている。相乗りは現実的な選択肢であり、検討せずに 2 台目を建てるべきではない。

さらに `docs/agents-local-mvp/adr.md` の [ADR-026](../agents-local-mvp/adr.md#adr-026-収束エンジンを-go-gdg-cli-とし宣言的-specピン留めpull-型配信を採用する) は、Ansible へ切り替える基準を明示している。

> Ansible への切替基準: **2 台目のホストが必要になる** / inventory 管理が必要になる /
> Go 収束エンジンが約 2,000 行を超えた時点で再検討する

DP を別 VM に置くなら、それが 2 台目である。この ADR はその条件に正面から答える義務を負う。

前提の更新: OCI の契約は **Pay-as-you-go** である。Always Free 枠しか無い場合に懸念される
A1.Flex（Ampere / arm64）の "Out of host capacity" は、この契約では読める。

### Decision

**1. DP は専用の OCI VM に置く。agent-host には相乗りさせない。**

相乗りを退ける理由は 4 つある。負荷ではなく、**境界と巻き込み**の問題である。

- **Discord Bot トークンが 1 台に 2 つ集まる。** agent-host は uid 分離・AppArmor・sudoers・
  Cursor サンドボックスで固めた機械だが、その労力は *wiki ワークツリーの読み書き* を
  囲うために払われている。そこへ常時外向き接続を持つ別資産を足すと、
  引いた境界の意味が薄まる。
- **別ワークロードの負荷スパイクが Discord のクォータを焼く経路ができる。**
  `cursor-agent` のスロットが CPU とメモリを掴んだとき、Gateway の heartbeat が遅れる。
  Discord は heartbeat 欠落でセッションを切り、再接続は IDENTIFY を消費する（1000 回/日、同時 1）。
  **relay の可用性が、relay と無関係なエージェント実行の混み具合に従属してはならない。**
- **agent-host の再インストールと検証が relay を巻き込む。** `install.sh` は本番経路を触る。
  agents-local の Stage 検証のたびに relay が落ちる構造にしない。
- **逆向きも真である。** relay の障害調査で agent-host の信頼境界に触れることになる。

**2. シェイプは `VM.Standard.A1.Flex`（arm64）。1 OCPU / 6 GB から始める。**

OS は Ubuntu 24.04 LTS（arm64）。agent-host と同じメジャーに揃え、手順の記憶を共有する。

**3. DP インスタンスは常に 1 台とする。**

同一 Bot トークン・同一シャードで Gateway セッションは排他であり
（[overview.md](../rdra/discord-relay/overview.md) が既に記録している）、
2 台目は leader election を要求する。冗長化は「速やかに作り直せること」で担保し、
稼働台数では担保しない。

**4. ADR-026 の切替基準への回答: Ansible には切り替えない。**

2 台目ではあるが、**役割の違う 2 台であって inventory ではない。**
加えて DP のプロビジョニング面積は agent-host の 1/10 以下である
（uid 分離なし・AppArmor なし・sudoers なし・サンドボックスなし・
[ADR-009](#adr-009-data-plane-を-go-で実装し単一の静的バイナリとして配る) によりランタイムのピン留めもなし）。
1 プロセス・1 バイナリ・秘密 2 つのホストに Ansible を持ち込むのは、
ADR-026 が「1 台の自前ホストに対して過剰な抽象化」として退けた理由がそのまま当てはまる。

**ただしこの決定は tripwire を 1 つ進めた。** 3 台目、あるいは
「同じ役割のホストが複数」が要求された時点で、この判断は無効になる。

### Alternatives Considered

**A. 既存の agent-host に相乗りする**

- Pros: 2 台目を作らない。`gdg agent-host` の収束エンジンをそのまま使える。ADR-026 の基準に触れない
- Cons: 上記 4 点
- Rejected

**B. `VM.Standard.E2.1.Micro`（x86-64、1 OCPU / 1 GB）を 2 台**

- Pros: Always Free の常時確保枠。DP の要求（WS 1 本 + 数秒ごとの POST）には足りる。
  x86-64 なので agent-host の per-arch ピン留めを流用できる
- Cons: 転送バッファの上限が 1 GB に縛られる。**そして ADR-009 で DP が単一静的バイナリになるため、
  「x86-64 のピンを流用できる」という唯一の利点が消える**（ホスト側にピン留めすべきランタイムが無い）
- Rejected: PAYG で A1 が確保できるなら、余白の大きいほうを採らない理由が無い

**C. Cloudflare Containers に置く**

- Cons: アイドルでスリープする設計であり、常時 WebSocket と噛み合わない。無料でもない
- Rejected

### Consequences

- **ホストが arm64 になる。** リリースは `GOOS=linux GOARCH=arm64`。
  `deploy.yml` は既に `gdg` を `linux/arm64` 向けにクロスコンパイルしているので、経路は実証済みである。
- **Pay-as-you-go には Always Free の上限で止まるガードレールが無い。**
  A1 は合計 4 OCPU / 24 GB、ブロックストレージは合計 200 GB を超えた分が課金される。
  1 OCPU / 6 GB で始めるのは、上限に対して意図的に余白を残すためでもある。
  **予算アラートを設定すること。**
- agent-host の `ENVIRONMENT.md` に相当する「実際にどこに何があるか」を relay 用にも書く必要がある。
  README が語る *あるべき配置* と、実機の配置は必ずずれる。
- 2 台目が増えたことを ADR-026 側にも追記する（この ADR への相互リンク）。

---

## ADR-009: Data Plane を Go で実装し、単一の静的バイナリとして配る

### Status

Accepted

### Date

2026-09-05

### Context

ADR-001 以降、DP の仕事は「WebSocket を 1 本持ち、粗いフィルタをかけ、バッファし、
数秒ごとに CP へ POST する」だけである。CPU も帯域も要求は小さい。

候補は Node ネイティブ TypeScript / Go / Rust の 3 つ。

`docs/agents-local-mvp/adr.md` の [ADR-022](../agents-local-mvp/adr.md#adr-022-ローカル実行物を-node-ネイティブ-typescript-に統一する) は
「ローカル実行物を Node ネイティブ TypeScript に統一する」と決めているが、
**その射程は agents-local の on-host 実行物**（フック、`wk`、ACL bundle）である。
理由も明示されている ——
(1) 依存をインストールできない `/opt/gdg-agent/` で動く必要がある、
(2) `gdg-lib` の ACL 評価器とコードを共有する必要がある。
DP はどちらにも当たらない。**ADR-022 は本件を拘束しない。**

そして速度は決め手にならない。実測した。

```
$ node -v && node -e "console.log(typeof WebSocket, typeof fetch)"
v24.18.0
function function
```

Node 22.4 以降にはグローバル `WebSocket` と `fetch` があり、`node:zlib` もある。
つまり **Node でも npm 依存ゼロで書ける**。毎秒数件のイベントを中継するプロセスで
Go と Node の実行速度を比べる意味は無い。**速度を理由に Go を選ぶことはできない。**

### Decision

**1. Go で実装する。理由は速度ではなく、ホストにランタイムを置かなくて済むことである。**

| | Node ネイティブ TS | **Go** |
|---|---|---|
| ホストに要るもの | Node をピン留めして導入 + ソースツリー + `package.json` marker | **バイナリ 1 個** |
| 配布物 | ソース（Bot トークンを持つ機械にソースが載る） | 静的バイナリ |
| 配布機構 | 新規に作る | **`pins.gdgCli` と同型**（ADR-026 が実装済み） |
| 供給網の固定 | npm 依存 0 なら不要だが Node 本体をピン留め | `go.sum` で暗号学的に固定 |
| CI のクロスコンパイル | 不要 | `deploy.yml` に `linux/arm64` が既にある |

決め手はこの行である。**Go を選ぶと、ADR-026 が既に作った
「pull 型・SHA256 照合・パイプ実行禁止」の配布経路にそのまま乗る。**
Node を選ぶと、その経路の外側にもう 1 本（Node のピン留めとソース配置）を作ることになる。
[ADR-011](#adr-011-デプロイをピン留めした静的バイナリの-pull-型収束としtick-経路をコード配布に使わない) がそれを前提にしている。

**2. Discord ライブラリを使わない。** `github.com/coder/websocket` の上に、
op 0 / 1 / 7 / 9 / 10 / 11 と再接続だけを自前で書く。

- `discordgo` も `discord.js` も、イベントを構造体に整形し guild / member をキャッシュする。
  DP が要るのは **生の `d` バイト列** である（ADR-004-5 の `dedupe_key` と、
  エンベロープの raw 同梱がそれを要求する）。得られる抽象の大半を捨てることになる。
- **RESUME の意味論は `dedupe_key` の正しさに直結する。** ここは他人のライブラリの
  再接続方針に委ねてよい場所ではない。
- 実装量は op の処理と再接続で 300〜500 行程度。`coder/websocket` は推移的依存を持たない。

**3. Rust は採らない。**

- リポジトリに Rust は 1 行も無い。toolchain・CI レーン・ピン留め・レビューできる人、の 4 つが新規に増える。
- 得られるもの（GC 無し、最小 RSS）は、24 GB の枠に 1 プロセスを置く本件では**測れない差**である。
- 再検討条件: DP が万単位のギルドを持ち、GC 停止が heartbeat を落とす実測が出たとき。

**4. モジュールは `discord-relay-gateway/` 直下に独立した `go.mod` を置く。** Go は `cli/` と同じ 1.23。

`cli/` の module には入れない。**開発者の端末に配るユーザー向け CLI にデーモンを同梱しない。**

### Alternatives Considered

**A. Node ネイティブ TypeScript（npm 依存ゼロ）**

- Pros: 成立する。ADR-022 と字面が揃う。CP と言語が揃う
- Cons: 「CP と言語が揃うから型を共有できる」は**成り立たない**。
  ADR-001 により DP は正規化しないので、DP と CP が共有するのは tick の JSON スキーマだけであり、
  それは OpenAPI で表現するほうが言語をまたげる（リポジトリは既に `oapi-codegen` と
  `openapi-typescript` を両方使っている）
- Rejected: 配布経路の理由（Decision 1）

**B. `gdg` CLI のサブコマンドにする（`gdg relay gateway`）**

- Pros: 配布が完全に既存機構に乗る。バイナリが増えない
- Cons: relay のリリース周期が CLI に縛られる。CLI は開発者の端末に配るものであり、
  そこに常駐デーモンを同梱することになる
- Rejected

**C. Rust** — 上記 Decision 3

### Consequences

- **CI の Go レーンが `cli/` 決め打ちである。** 一般化が要る。具体的には次の 4 か所。
  - `scripts/run-ci.mjs` の `go` ステップ（`cd cli` と `./cmd/gdg`）
  - `.github/scripts/changed-workspaces.mjs` の `file.startsWith("cli/")`
  - `.github/workflows/ci.yml` の "CLI (Go)" ジョブ
  - `.github/workflows/deploy.yml` に `relay-gateway/v*` タグのリリースジョブ
- **canonical JSON を Go 側で明示的に実装する必要がある。**
  `encoding/json` は map のキーをソートするが、`any` を経由した往復は数値の表現を変えうる。
  `dedupe_key` の安定性はここに乗っているので、キー順と数値レキシムの扱いを自前で定義し、
  **RESUME 再配送で同じ値になることをテストで固定する。**
  なお `dedupe_key` を計算するのは DP だけであり（CP は受け取った値を使う）、
  **Go と TypeScript の間で正規化の一致を要求される場面は無い。**
- `gofmt` / `go vet` / `go test` が DP にも適用される。Biome は DP を見ない。
- tick のスキーマが CP（TypeScript）と DP（Go）で二重定義になる。SSoT は OpenAPI に置き、両側を生成する。

---

## ADR-010: systemd の system unit で常駐させ、状態は StateDirectory・秘密は LoadCredential に置く

### Status

Accepted

### Date

2026-09-05

### Context

DP は 24 時間動き続ける。異常の検知は CP 側の heartbeat（EVT-501）が担うが、
**プロセスの生存と再起動はホストの責務**である。

agent-host は systemd の `--user` unit と linger を使っているが、あれは uid 分離のためであり、
DP には同じ要求が無い。

### Decision

**1. system unit にする。`DynamicUser=yes` + `StateDirectory=discord-relay-gateway`。**
管理対象の uid を作らない。

**2. 秘密は `LoadCredential=` で渡す。** root 所有の `/etc/discord-relay-gateway/` から読み、
`$CREDENTIALS_DIRECTORY` 経由でこのサービスにだけ見せる。

- `bot-token` — Discord Bot トークン
- `cp-shared-secret` — ADR-005 の 2 鍵（現行と次期）

**環境変数には置かない。** `/proc/<pid>/environ` と journal に漏れる。

**3. `Type=notify` + `WatchdogSec=60s`。** Gateway ループが前進しているときだけ
`sd_notify` で `WATCHDOG=1` を打つ。**「イベントが来ない」と「ループが固まった」を区別する。**
Go では `NOTIFY_SOCKET` に書くだけで、依存は要らない。

**4. `Restart=always` / `RestartSec=5s`、加えて `StartLimitIntervalSec` と `StartLimitBurst` を置く。**
クラッシュループで IDENTIFY を焼き切らないための上限である。

**5. 強化オプション**: `ProtectSystem=strict`, `ProtectHome=yes`, `PrivateTmp=yes`,
`NoNewPrivileges=yes`, `RestrictAddressFamilies=AF_INET AF_INET6`, `MemoryMax=`。

**6. `StateDirectory`（`/var/lib/discord-relay-gateway/`）に残すのは 3 つだけ。**

| ファイル | 内容 | 失ったときに起きること |
|---|---|---|
| `config.json` | ADR-003 の最後に成功した購読仕様 + ETag | CP 障害中に再起動すると全チャプター停止 |
| `session.json` | `session_id` / `seq` / `resume_gateway_url` | RESUME できず IDENTIFY を 1 消費 |
| `pending.jsonl` | SIGTERM 時に退避した未 ack の転送バッファ | 通常の再起動でイベントを失う |

**7. 再起動時は IDENTIFY ではなく RESUME を試みる。**

`session.json` を先に読む。デプロイの再起動は数秒で終わるので Discord の RESUME 窓に入る。
IDENTIFY は 1000 回/日・同時 1 の制約があり、**クラッシュループで枯らすと復旧手段が無くなる。**
RESUME に失敗したら（op 9）通常どおり IDENTIFY にフォールバックし、`session.json` を消す。

これは RDRA の UC-103 が既に要求している RESUME を、
**プロセス再起動という切断理由にも適用する**という追加である。

**8. `pending.jsonl` は graceful shutdown（SIGTERM）でのみ書く。クラッシュでは失う。**

ここを完全にするには全イベントを同期書き込みする必要があり、Stage 1 の対価に見合わない。
**失う可能性があると明示するほうが、静かに失うより良い。**

### Alternatives Considered

**A. `--user` unit + linger（agent-host と同じ）**

- Cons: uid 分離の要求が無く、`DynamicUser` のほうが管理面が小さい
- Rejected

**B. Docker / Podman**

- Cons: agents-local-mvp の [ADR-023](../agents-local-mvp/adr.md#adr-023-ローカル検証環境を-ubuntu-vm-に置きdocker-を採らない) が、systemd の本番経路を再現できないという理由で
  Docker を退けている。加えて、静的バイナリ 1 個のためにコンテナランタイムをホストへ足す理由が無い
- Rejected

**C. 状態を持たず、毎回 IDENTIFY する**

- Cons: Decision 7 のとおりクォータを焼く
- Rejected

### Consequences

- ホストに必要なものが「バイナリ 1 個 + unit ファイル + `/etc` の秘密 2 つ」だけになる。
- **`IPAddressDeny=link-local` によるメタデータ遮断は採らない。**
  OCI では `169.254.169.254` が VCN の DNS リゾルバも兼ねるとされ、link-local を塞ぐと
  名前解決が死ぬ可能性がある。塞ぐなら先に `resolv.conf` を公開リゾルバへ切り替える依存が生じる。
  ADR-001 で DP は任意 URL を fetch しなくなっており、宛先は Discord と CP に限られるため、
  この強化は防御の 2 枚目にすぎない。**実機で `169.254.169.254` の役割を確認してから**判断する。
- **`WatchdogSec` は「Gateway が繋がっている」ではなく「ループが前進している」を検出する。**
  切断後の再接続待ちでも `WATCHDOG=1` を打つこと。打たないと再接続中に殺される。
- INFO-010 の実体がディスクに永続されることになる。RDRA の記述を追随させる。

---

## ADR-011: デプロイをピン留めした静的バイナリの pull 型収束とし、tick 経路をコード配布に使わない

### Status

Accepted

### Date

2026-09-05

### Context

ADR-026 は pull 型配信・SHA256 照合・validate-then-rename を確立している。DP はその 2 台目である。

一方 ADR-004 の tick には既に CP から DP への経路がある。
応答に `desired_version` を載せて自己更新させる実装は、技術的には数十行で書ける。
**書けるからといって書いてよいわけではない。**

### Decision

**1. CI がタグ `relay-gateway/v*` で `linux/arm64`（と開発用の `linux/amd64`）をクロスコンパイルし、
GitHub Release に tar.gz と SHA256 を出す。ホストに Go toolchain を置かない。**

**2. ホスト側は spec JSON にバージョンと per-arch SHA256 をピン留めし、systemd timer で定期収束する。**

取得 → SHA256 照合 → 一時ファイルへ書き出し → `mv -f` で原子的に置換 → `systemctl restart`。
ADR-026 の `pins.gdgCli` と同型である。

**3. 収束は `gdg` CLI のサブコマンド（`gdg relay-host`）に置く。**
agent-host と同じエンジン・同じ「spec + JSON Schema」の作法にする。

**4. tick 経路をコード配布に使わない。**

ADR-004 のコマンドは `restart` / `reconnect` のような運用操作に限る。
「このバージョンを取ってこい」は載せない。

理由は明快である。ADR-005 で Plane 間認証を共有シークレットにした。
CP を取られたときの被害を **「購読仕様の書き換えと偽イベントの注入」** に留めるためであり、
そこにコード実行を足すと **CP 侵害 = DP の RCE = Bot トークン奪取** になる。
境界を狭めた ADR-001 と ADR-005 の意味が消える。

**5. ロールバックは spec のピンを戻すだけ。** バイナリは 1 世代前を残す。

### Alternatives Considered

**A. tick 応答による自己更新** — Rejected（Decision 4）

**B. ホストで `git clone` して `go build`**

- Cons: Bot トークンを持つ機械に toolchain とソースを置く。ビルドの再現性もホスト依存になる
- Rejected

**C. self-hosted GitHub Actions runner から push デプロイ**

- Rejected: ADR-026 が同じ理由（public リポジトリでは fork PR からのコード実行経路になる）で却下済み

**D. ssh デプロイ**

- Rejected: 同上（CI に root 相当の鍵を持たせることになる）

### Consequences

- **リリースは手動タグで始まる。`main` への push で自動デプロイしない。**
  Gateway セッションを切る操作なので、意図して打つ。
- Go の収束エンジンが agent-host 用と relay 用の 2 役になる。
  ADR-026 の「約 2,000 行を超えたら Ansible を再検討」に近づく。**行数を計測対象にする。**
- 更新のたびに Gateway が切れる。[ADR-010](#adr-010-systemd-の-system-unit-で常駐させ状態は-statedirectory秘密は-loadcredential-に置く) の RESUME で吸収されるが、
  頻繁なデプロイは IDENTIFY を消費しうる。

---

## RDRA への影響

ADR-001 の採用にともない、[RDRA](../rdra/discord-relay/overview.md) の以下を更新した（適用済み）。
**要素の追加・削除は無く、担当 Plane と識別子の定義が変わるだけ**なので、
トレーサビリティ（162 要素、孤立 0）は維持される。

| RDRA 要素 | 変更 | 対象ファイル |
|---|---|---|
| Plane 分割表 | DP の責務を「Gateway 接続・粗いフィルタ・転送」に縮小 | `overview.md` |
| UC-401〜UC-407（評価・正規化・キュー・配信・署名・リトライ・DLQ） | 担当を DP → CP | `contexts/event-delivery.md` |
| UC-408（バックプレッシャ） | DP の転送バッファと CP の Queues の 2 段に分割 | `contexts/event-delivery.md` |
| COND-403（キュー上限） | 「転送バッファ上限」と「Queues 上限」の 2 条件に | `contexts/event-delivery.md` |
| COND-404（配信時 SSRF 再評価） | 必須要件は維持。位置づけを「多層防御の 1 枚目」に | `contexts/event-delivery.md` |
| エンベロープ `id` | ULID → `sha256(dedupe_key ‖ rule_id)` の決定的な値（ADR-004-5） | `contexts/event-delivery.md` |
| INFO-007 / 008 / 009 の SSoT | DP → CP（メタ D1・本文 R2） | `shared/information-model.md` |
| INFO-010 GatewaySession | DP のまま。heartbeat で CP に複製されることを追記 | `shared/information-model.md` |
| UC-605（Plane 間認証） | 「Tunnel + Access / 共有シークレット / mTLS のいずれか」→ Bearer 共有シークレット | `contexts/auth.md` |
| REQ-602 | 「露出しない」の実現根拠を「経路が存在しない」に | `contexts/auth.md` |
| SCR-30x（ルール編集画面） | 「設定の反映待ち」表示を追加（ADR-003） | `contexts/rule-management.md` |
| SETUP タスク | Plane 間シークレットのローテーション手順を追加 | `overview.md` |

ADR-008〜011 の採用にともない、さらに以下を更新した（適用済み）。こちらも要素の増減は無い。

| RDRA 要素 | 変更 | 対象ファイル |
|---|---|---|
| Plane 分割表の実行環境 | 「OCI 無料枠 VM」→ `VM.Standard.A1.Flex`（arm64）1 台（ADR-008） | `overview.md` |
| UC-103（セッション再開） | RESUME の対象に**プロセス再起動**を明記（ADR-010-7） | `contexts/connection-platform.md` |
| INFO-010 GatewaySession | 実体が DP の**ディスク**にあることを明記 | `shared/information-model.md` |
| SSoT 分担表 | Gateway セッション状態の保持先を「OCI のディスク」に | `shared/information-model.md` |

**`docs/agents-local-mvp/adr.md` への影響**: ADR-008 は同文書 ADR-026 の
「Ansible への切替基準: 2 台目のホストが必要になる」に抵触する。抵触したうえで
**切り替えないと決めた**ので、あちら側にも相互リンクを張る必要がある（未適用）。
ADR-011 は同 ADR-026 の pull 型配信をもう 1 台に広げるだけで、抵触しない。

**却下された案（fat DP）の記録**: ADR-001 を却下した場合は ADR-006 が破棄され、
ADR-002〜005 と 007 はそのまま成立していた（tick の中身から `events` が消え、
代わりに配信テレメトリが載る形）。将来 supersede する際の出発点として残す。

## 未決事項

この ADR で決めていないもの。実装ステージで詰める。

| 論点 | 備考 |
|---|---|
| DP の転送バッファ上限 | 「CP 障害が何分続いたら失い始めるか」を決める値。実測が要る |
| 初期に有効化する特権 Intent | RDRA の SETUP-2。`MESSAGE_CONTENT` は確定、他は要件次第 |
| `169.254.169.254` の役割 | OCI では VCN DNS リゾルバも兼ねるとされる。ADR-010 の link-local 遮断の可否は実機確認が要る |
| Gateway の transport 圧縮 | `zlib-stream` を使うか。ギルド数が小さいうちは無圧縮で足りる見込み |
| tick スキーマの OpenAPI 化の範囲 | ADR-009 で二重定義が生じる。生成を両側に入れるか、DP 側だけ手書きにするか |
| 宛先ごとのレート制限の本実装 | ADR-006 で best-effort とした。DO を挟むかどうか |
| アラート（EVT-501）の通知経路 | Discord / メール / その他。BIZ-005 の実装ステージで決める |
