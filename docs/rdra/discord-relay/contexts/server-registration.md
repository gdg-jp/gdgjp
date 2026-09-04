---
type: rdra-context
id: "BIZ-002"
name: "server-registration"
display_name: "サーバー登録"

value:
  goals: ["GOAL-003", "GOAL-004"]
  requirements:
    - id: "REQ-201"
      description: "Discord サーバーの所有チャプターを、他チャプターが詐称できない形で確定できること"
      traces_to: ["GOAL-003"]
    - id: "REQ-202"
      description: "Bot がサーバーから外れたことを検知し、関連するルールを黙って死なせないこと"
      traces_to: ["GOAL-004"]

environment:
  business_usecases:
    - id: "BUC-201"
      name: "Discord サーバーをチャプターに登録する"
      actors: ["ACTOR-001"]
      description: "organizer が招待リンクから Bot を自サーバーに入れ、その結果をもってチャプターへの紐付けを確定する"
      traces_to: ["REQ-201"]
    - id: "BUC-202"
      name: "Bot 退出を検知して設定を停止する"
      actors: ["ACTOR-005"]
      description: "GUILD_DELETE を受けて紐付けを離脱状態にし、該当ルールを自動停止して organizer に知らせる"
      traces_to: ["REQ-202"]
    - id: "BUC-203"
      name: "紐付けを移管・解除する"
      actors: ["ACTOR-001", "ACTOR-003"]
      description: "organizer は自チャプターの紐付けを解除できる。チャプター間の移管は admin のみ"
      traces_to: ["REQ-201"]

boundary:
  usecases:
    - id: "UC-201"
      name: "招待リンクを発行する"
      actors: ["ACTOR-001"]
      screens: ["SCR-201"]
      traces_to: ["BUC-201"]
      description: "ワンタイムの claim token を発行し、state に載せた Discord OAuth2 招待 URL を組み立てる"
    - id: "UC-202"
      name: "招待コールバックを検証して紐付けを確定する"
      actors: ["ACTOR-006"]
      events: ["EVT-201"]
      traces_to: ["BUC-201"]
      description: "state を突合し、Discord が返した guild_id をチャプターに紐付ける。code はトークン交換して整合を確認する"
    - id: "UC-203"
      name: "紐付け済みサーバーを一覧する"
      actors: ["ACTOR-001", "ACTOR-002"]
      screens: ["SCR-202"]
      traces_to: ["BUC-201", "BUC-202"]
      description: "チャプターに紐付いたギルドと在籍状態を表示する。member も閲覧できる"
    - id: "UC-204"
      name: "紐付けを解除する"
      actors: ["ACTOR-001"]
      screens: ["SCR-202"]
      traces_to: ["BUC-203"]
      description: "organizer が自チャプターの紐付けを外す。該当ギルドのルールも停止される"
    - id: "UC-205"
      name: "Bot 退出を検知してルールを自動停止する"
      actors: ["ACTOR-005"]
      events: ["EVT-202"]
      traces_to: ["BUC-202"]
      description: "GUILD_DELETE を受けて紐付けを離脱状態に遷移させ、該当ルールを停止して通知する"
    - id: "UC-206"
      name: "紐付けを他チャプターへ移管する"
      actors: ["ACTOR-003"]
      screens: ["SCR-203"]
      traces_to: ["BUC-203"]
      description: "誤登録やチャプター統合に対応する admin 専用操作。監査ログに必ず残す"
    - id: "UC-207"
      name: "Bot 再参加を検知する"
      actors: ["ACTOR-005"]
      events: ["EVT-203"]
      traces_to: ["BUC-202"]
      description: "離脱状態のギルドに GUILD_CREATE が来たら在籍状態へ戻す。ルールは自動再開せず organizer の確認を待つ"
  screens:
    - id: "SCR-201"
      name: "サーバー追加画面"
      description: "招待リンクの発行と手順の案内。claim token の残り有効期限を表示する"
      information: ["INFO-003"]
    - id: "SCR-202"
      name: "サーバー一覧画面"
      description: "紐付け済みギルドと在籍状態、解除操作"
      information: ["INFO-002"]
    - id: "SCR-203"
      name: "紐付け移管画面 (admin)"
      description: "ギルドの所属チャプターを付け替える"
      information: ["INFO-002", "INFO-012"]
  events:
    - id: "EVT-201"
      name: "Discord OAuth2 コールバック受信"
      trigger: "Discord が redirect_uri に code / state / guild_id / permissions を返す"
      description: "紐付け確定の起点。Control Plane (Workers) が受ける"
    - id: "EVT-202"
      name: "GUILD_DELETE 受信"
      trigger: "Bot がサーバーから removed / kicked / ban された"
      description: "在籍追跡の入力。unavailable フラグ付きの一時的な停止と区別する"
    - id: "EVT-203"
      name: "GUILD_CREATE 受信"
      trigger: "Bot が新しいサーバーに参加した、または READY 後の初期同期"
      description: "在籍追跡とギルドメタのキャッシュ更新"

system:
  information: ["INFO-001", "INFO-002", "INFO-003", "INFO-012"]
  states: ["STATE-002"]
  conditions:
    - id: "COND-201"
      name: "claim token が有効期限内かつ未使用"
      description: "発行から 15 分以内、単回使用。期限切れ・使用済みなら紐付けを拒否する"
      traces_to: ["UC-202"]
    - id: "COND-202"
      name: "guild_id が他チャプターに未 claim"
      description: "既に他チャプターが claim 済みのギルドは拒否する。移管は UC-206 でのみ可能"
      traces_to: ["UC-202"]
    - id: "COND-203"
      name: "操作者が対象チャプターの organizer"
      description: "招待リンク発行・解除は organizer のみ。member は UC-203 の閲覧だけ"
      traces_to: ["UC-201", "UC-204"]
    - id: "COND-204"
      name: "Discord 側の権限は Discord に委譲する"
      description: "Bot を招待できるのは対象サーバーで Manage Guild 権限を持つ者だけ。アプリ側で権限を再検証しない"
      traces_to: ["UC-202"]
  variations:
    - id: "VAR-201"
      name: "紐付け解除の理由"
      values: ["organizer による手動解除", "Bot の退出 (GUILD_DELETE)", "admin による移管"]
      description: "解除理由により、ルールの扱いと通知先が変わる"
      traces_to: ["UC-204", "UC-205", "UC-206"]
---

# BIZ-002 サーバー登録

「この Discord サーバーはこのチャプターのものである」を、詐称できない形で確定する。

## 検証の考え方

**Discord 側の権限判定をそのまま信頼する。** Bot を招待できるのは、そのサーバーで
「サーバーの管理」権限を持つ者だけである。したがって「招待に成功した」という事実自体が
「その人はそのサーバーの管理者である」ことの証明になる。アプリ側で Discord のロールを
読み直す必要はない（COND-204）。

`response_type=code` と `redirect_uri` を付けた招待 URL を使うことで、Discord は
コールバックに **`guild_id` と `state` を返す**。これにより `GUILD_CREATE` の到着を
待たずに紐付けを確定できる。

## 既存実装との関係

wiki が同じ形の招待フローを実装済みで、実装パターンをそのまま踏襲できる。

| wiki の実装 | 本アプリでの対応 |
|---|---|
| `wiki/app/routes/api/discord/auth.ts` | UC-201 招待リンク発行の参考 |
| `wiki/app/routes/api/discord/callback.ts` | UC-202 コールバック検証の参考 |
| `wiki/app/routes/api/discord/guilds.ts` | botInstalled フラグ付きサーバー一覧の参考 |
| `wiki/app/features/discord/oauth.server.ts` / `token.server.ts` | トークン交換の参考 |
| `wiki/app/routes/sources/_components/DiscordChannelDialog.tsx` | SCR-201 の UI 参考 |

**ただし `wiki.discord_guild_settings` テーブルは共有しない。** 目的が「リマインダー送信先チャンネル」で
あり、`chapter_id` の UNIQUE 制約により 1 チャプター 1 ギルドに固定されている。本アプリは
1 チャプターに複数ギルドを許すため、自前のテーブル（INFO-002）を持つ。

**Bot は専用 Application のもの**（overview.md D-9）なので、wiki の Bot が既に入っている
サーバーであっても、本アプリの Bot は改めて招待が必要になる。

## 業務フロー: BUC-201 Discord サーバーをチャプターに登録する

```mermaid
sequenceDiagram
    actor ORG as ACTOR-001 organizer
    participant CP as Control Plane
    participant DC as ACTOR-006 Discord
    participant GW as ACTOR-005 Gateway
    participant DP as Data Plane

    ORG->>CP: SCR-201 サーバーを追加
    CP->>CP: COND-203 organizer か検証
    CP->>CP: UC-201 claim token 発行 (15 分・単回)
    CP-->>ORG: 招待 URL を提示 (scope=bot, response_type=code, state=claim token)

    ORG->>DC: 招待 URL を開き、サーバーを選んで承認
    Note over ORG,DC: COND-204 この操作は Manage Guild 権限保持者しかできない
    DC-->>CP: EVT-201 callback (code, state, guild_id, permissions)

    CP->>CP: COND-201 state の有効期限と未使用を検証
    CP->>CP: COND-202 guild_id が未 claim か検証
    CP->>DC: code をトークン交換して整合を確認
    DC-->>CP: guild 情報
    CP->>CP: UC-202 INFO-002 を Claimed で作成
    CP-->>ORG: SCR-202 紐付け完了

    GW-->>DP: EVT-203 GUILD_CREATE
    DP->>CP: 在籍を確認、ギルド/チャンネル一覧を同期
    Note over CP: これでルール編集のセレクタに出るようになる
```

## 業務フロー: BUC-202 Bot 退出を検知して設定を停止する

```mermaid
sequenceDiagram
    participant GW as ACTOR-005 Gateway
    participant DP as Data Plane
    participant CP as Control Plane
    actor ORG as ACTOR-001 organizer

    GW-->>DP: EVT-202 GUILD_DELETE
    alt unavailable = true
        Note over DP: Discord 側の一時的な障害。紐付けは変更しない
    else Bot が実際に退出/kick された
        DP->>CP: UC-205 退出を報告
        CP->>CP: INFO-002 を Detached へ遷移
        CP->>CP: 該当ギルドのルールを Suspended へ
        CP-->>ORG: 通知 (ルールが停止した旨)
    end

    Note over ORG,CP: 再招待した場合
    GW-->>DP: EVT-203 GUILD_CREATE
    DP->>CP: UC-207 再参加を報告
    CP->>CP: INFO-002 を Claimed へ戻す
    Note over CP: ルールは自動再開しない。organizer が明示的に有効化する
```

## ロバストネス図: UC-202 招待コールバックを検証して紐付けを確定する

```mermaid
flowchart LR
    DC(["ACTOR-006<br/>Discord"])
    EVT201["EVT-201<br/>OAuth2 コールバック"]
    C1["state 検証<br/>COND-201"]
    C2["重複 claim 検証<br/>COND-202"]
    C3["code トークン交換"]
    C4["紐付け確定"]
    INFO003[("INFO-003<br/>GuildClaim")]
    INFO002[("INFO-002<br/>Guild")]
    INFO012[("INFO-012<br/>AuditLog")]
    SCR202["SCR-202<br/>サーバー一覧"]

    DC --- EVT201
    EVT201 --- C1
    C1 --- INFO003
    C1 --- C2
    C2 --- INFO002
    C2 --- C3
    C3 --- C4
    C4 --- INFO002
    C4 --- INFO012
    C4 --- SCR202

    classDef actor fill:#e8f0fe,stroke:#4285f4
    classDef boundary fill:#fef7e0,stroke:#fbbc04
    classDef control fill:#e6f4ea,stroke:#34a853
    classDef entity fill:#fce8e6,stroke:#ea4335
    class DC actor
    class EVT201,SCR202 boundary
    class C1,C2,C3,C4 control
    class INFO003,INFO002,INFO012 entity
```

## 設計上の注意

- **`GUILD_DELETE` の `unavailable`**: Discord 側の一時障害では `unavailable: true` が来る。
  これを退出と誤認すると、障害のたびにルールが止まる。必ず区別する。
- **再参加でルールを自動再開しない**: 一度停止したルールを黙って再開すると、
  意図しない配信が復活し得る。organizer の明示操作を要求する。
- **claim token はチャプターに束縛する**: token 単体が漏れても、発行時のチャプター以外には
  紐付けられないようにする。
