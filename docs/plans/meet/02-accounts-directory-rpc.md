# Stage 02 — accounts-directory-rpc `MeetDirectoryService` RPC とチャプター参照クライアント

## Context — 背景とリポジトリ状況

**着手前に [`docs/plans/meet/00-overview.md`](00-overview.md) と [`docs/plans/meet/00a-poc-findings.md`](00a-poc-findings.md) を読むこと。**

### なぜやるか

`meet.gdgs.jp` が会議の主催チャプターの Organizer や他チャプターの Organizer / Member を自動で招待・`COHOST` 登録するには、`apps/accounts/` の D1 にあるチャプター所属データ（`memberships` と `user` のメールアドレス・氏名）を参照する必要がある。

`apps/accounts/` の既存公開エンドポイント `GET /api/chapters/directory` はチャプター一覧（id / slug / name 等）のみを返し、メンバー個人やメールアドレスは秘匿している。そこで `apps/accounts/` に Cloudflare service binding 専用の名前付き `WorkerEntrypoint`（`MeetDirectoryService`）を新設し、正規のバインディングを持つ `apps/meet` からだけアクティブなチャプターメンバーを取得できるようにする。

### 依存と対象範囲

- 依存: Stage 01（`apps/meet/` 骨格）。**Stage 03 と並行実装できる。**
- 対象: `packages/gdg-lib/`（RPC 契約型）、`apps/accounts/`（`MeetDirectoryService` 実装と公開）、`apps/meet/`（`ACCOUNTS_DIRECTORY` service binding と `app/features/directory/` ラッパー）
- 本ステージのスコープ外（**実装しない**）:
  - 会議の作成・表示 UI や会議テーブル（Stage 04 の担当）
  - Google API 接続（Stage 03 の担当）
  - `apps/accounts/` 既存の認証フロー・管理 UI・`/api/chapters/directory` 自体の変更

### 読むべきもの

- `packages/gdg-lib/src/pr-rpc.ts` と `packages/gdg-lib/src/index.ts` — service-binding RPC の契約型スタイル（`PrActor`, `PrRpcResult`）
- `apps/sns/workers/app.ts` と `apps/sns/app/features/auth/rpc-access.server.ts` — `WorkerEntrypoint<Env>` と例外を投げない RPC 実装の手本
- `apps/accounts/workers/app.ts` と `apps/accounts/wrangler.toml` — `accounts` Worker のエントリポイント
- `apps/accounts/schema.sql` — `chapters`, `"user"`, `memberships` テーブル定義
- `apps/accounts/app/features/memberships/repository.server.ts` — 既存の所属クエリ（`status = 'active'` の扱い）
- `apps/accounts/app/routes/api.chapters.directory.ts` — チャプター一覧 API のレスポンス形式

### 再利用する既存実装（書き直さない）

- **`apps/accounts/app/routes/api.chapters.directory.ts`** — チャプター一覧（`id`, `slug`, `name`, `kind`, `region`）は既存のこのルートを `ACCOUNTS` service binding 経由で呼ぶ。`MeetDirectoryService` に重複したチャプター一覧メソッドを作らない
- **`packages/gdg-lib/src/pr-rpc.ts` の `PrRpcResult<T>` 設計パターン** — Binding 越えで例外を投げると型情報が失われるため、`{ ok: true, ... } | { ok: false, code, message? }` の値返却スタイルを踏襲する

## Design — 設計

### 1. RPC 契約型（`packages/gdg-lib/src/meet-rpc.ts`）

新規ファイル `packages/gdg-lib/src/meet-rpc.ts` を作成し、`packages/gdg-lib/src/index.ts` から `export * from "./meet-rpc";` で再エクスポートする（型のみ、ランタイムコードは置かない）。

```ts
import type { AuthUser, ChapterRole, UserChapter } from "./auth";

export type MeetActor = { user: AuthUser; chapters: UserChapter[] };

export type MeetRpcFailure = { ok: false; code: string; message?: string };
export type MeetRpcResult<T> = ({ ok: true } & T) | MeetRpcFailure;

export type MeetDirectoryMember = {
  userId: string;
  name: string;
  email: string;
  chapterId: number;
  chapterSlug: string;
  chapterName: string;
  role: ChapterRole;
};

export type ListChapterMembersInput = {
  actor: MeetActor;
  chapterIds: number[];
  roles?: ChapterRole[];
};

export interface MeetDirectoryService {
  listChapterMembers(
    input: ListChapterMembersInput,
  ): Promise<MeetRpcResult<{ members: MeetDirectoryMember[] }>>;
}
```

### 2. `apps/accounts/` 側の実装

#### 2-1. `apps/accounts/app/features/memberships/meet-directory.server.ts`（新規）

`listMeetChapterMembers(db: D1Database, input: ListChapterMembersInput)` を実装する。

1. **呼び出し主体（`actor`）の厳格検証**:
   - `actor?.user?.id` が空でないことを検証する。
   - **引数 `actor.chapters` のクレームを鵜呑みにしない。** `apps/accounts` の DB 上で、次の条件を満たすか直接問い合わせる:
     ```sql
     SELECT 1 FROM memberships WHERE user_id = ? AND status = 'active' LIMIT 1
     ```
   - 承認済み所属が 1 件も存在しない場合は `{ ok: false, code: "forbidden" }` を返す（`pending` のみのユーザーや退会済みユーザーを拒否する）。
2. **入力バリデーション**:
   - `chapterIds`: 正の整数の配列として重複除去（`Set`）する。
     - 空配列の場合は DB クエリせず `{ ok: true, members: [] }` を返す。
     - 件数が上限 `MAX_MEET_DIRECTORY_CHAPTER_IDS = 50` を超える場合は `{ ok: false, code: "too_many_chapters" }` を返す。
     - 正の整数でない値が含まれる場合は `{ ok: false, code: "invalid_chapter_ids" }` を返す。
   - `roles`: 省略時は `["organizer", "member"]`。`"organizer"` / `"member"` 以外が含まれるか空配列なら `{ ok: false, code: "invalid_roles" }` を返す。
3. **メンバー取得クエリ**:
   - `memberships m`、`JOIN "user" u ON u.id = m.user_id`、`JOIN chapters c ON c.id = m.chapter_id` を結合する。
   - 条件は **`m.status = 'active'`**（必須）かつ `m.chapter_id IN (...)` かつ `m.role IN (...)`。
   - 並び順は `c.id ASC, CASE m.role WHEN 'organizer' THEN 0 ELSE 1 END, u.name ASC`。
   - 存在しない `chapterId` が含まれていてもエラーにせず、存在する分のみ返す（全件不在なら空配列）。
4. 予期しない例外をキャッチして `{ ok: false, code: "internal_error" }` に変換し、決して例外を throw しない。

#### 2-2. `apps/accounts/workers/app.ts`

`WorkerEntrypoint` を継承した名前付きクラスを export する（`apps/sns/workers/app.ts` の `PrService` と同形式）。

```ts
import { WorkerEntrypoint } from "cloudflare:workers";
import type {
  ListChapterMembersInput,
  MeetDirectoryService as MeetDirectoryServiceContract,
} from "@gdgjp/gdg-lib";
import { listMeetChapterMembers } from "~/features/memberships/meet-directory.server";

export class MeetDirectoryService
  extends WorkerEntrypoint<Env>
  implements MeetDirectoryServiceContract
{
  listChapterMembers(input: ListChapterMembersInput) {
    return listMeetChapterMembers(this.env.DB, input);
  }
}
```

### 3. `apps/meet/` 側のバインディングとクライアント（`app/features/directory/`）

#### 3-1. `apps/meet/wrangler.toml`

`ACCOUNTS_DIRECTORY` service binding を追加し、`pnpm --filter @gdgjp/meet cf-typegen` で `Env` 型を再生成する。

```toml
[[services]]
binding = "ACCOUNTS_DIRECTORY"
service = "gdgjp-accounts"
entrypoint = "MeetDirectoryService"
```

#### 3-2. `apps/meet/app/features/directory/`（新規）

- `directory.ts`（ブラウザ共有可能な型）:
  - `ChapterSummary = { id: number; slug: string; name: string; kind: string; region: string }`（**メンバーの email 等はここにもクライアント向け型にも含めない**）
- `directory.server.ts`:
  - `fetchChaptersDirectory(env: Env): Promise<ChapterSummary[]>`: `env.ACCOUNTS.fetch(new URL("/api/chapters/directory", env.ACCOUNTS_URL).toString())` を呼び、レスポンス JSON の `chapters` を `id: Number(...)` に変換して返す。
  - `fetchChapterMembers(env: Env, input: ListChapterMembersInput): Promise<MeetDirectoryMember[]>`: `env.ACCOUNTS_DIRECTORY.listChapterMembers(input)` を呼び、`ok: false` なら型付きの `DirectoryError(code, message)` を投げる（サーバー内部専用）。

### 制約

- **UI（画面・ルート）をこのステージで作らない。** 理由: UI は Stage 04 の担当であり、本ステージは RPC 契約・権限検証・データ取得ラッパーに閉じる。
- **`MeetDirectoryService` の生の返却結果（作成前プレビュー等）を `apps/meet` の route `loader` / `action` からブラウザへ渡さない。** 理由: 作成前の人数プレビュー等でチャプターメンバーの氏名・メールアドレスを露出させないため（00-overview §2）。一方、作成済み会議の詳細ページでは PoC 決定（00-overview §2）に従い、`meeting_invitees` に保存された招待者のメールアドレスを表示する。
- **`accounts` 側で `actor.chapters` の自己申告を信頼しない。** 理由: RPC 呼び出し元から渡された主張ではなく、`accounts` D1 の `memberships (status = 'active')` を毎回確認して fail-closed にする。
- **service binding 以外の HTTP ルートとしてメンバー一覧を公開しない。** 理由: チャプターメンバーのメールアドレス一覧は `gdgjp-meet` Worker からの内部 RPC のみに限定する。

## Files to touch — 変更ファイル

### `packages/gdg-lib/`

- `src/meet-rpc.ts`（新規）
- `src/index.ts`

### `apps/accounts/`

- `workers/app.ts`
- `app/features/memberships/meet-directory.server.ts`（新規）
- `app/features/memberships/meet-directory.server.test.ts`（新規）

### `apps/meet/`

- `wrangler.toml`
- `ARCHITECTURE.md`（directory feature の記載追記）
- `app/features/directory/directory.ts`（新規）
- `app/features/directory/directory.server.ts`（新規）
- `app/features/directory/directory.server.test.ts`（新規）

## Verification — 完了条件と検証

### 1. 完了条件

1. `packages/gdg-lib` から `MeetDirectoryService` 等の契約型が export され、`@gdgjp/accounts` と `@gdgjp/meet` の双方が型エラーなしでビルド・typecheck を通る。
2. `MeetDirectoryService` が `apps/accounts/workers/app.ts` から export され、`apps/meet` の `cf-typegen` により `Env.ACCOUNTS_DIRECTORY` が生成される。
3. `meet-directory.server.test.ts` と `directory.server.test.ts` がすべて PASS する。

### 2. コマンド

```sh
pnpm --filter @gdgjp/gdg-lib typecheck
pnpm --filter @gdgjp/gdg-lib test
pnpm --filter @gdgjp/accounts cf-typegen
pnpm --filter @gdgjp/accounts typecheck
pnpm --filter @gdgjp/accounts test
pnpm --filter @gdgjp/meet cf-typegen
pnpm --filter @gdgjp/meet typecheck
pnpm --filter @gdgjp/meet test
pnpm ci:quick
```

### 3. 回帰として固定すべきテスト

- **`meet-directory.server.test.ts`**:
  - `status = 'pending'` のメンバーシップは一切返却されない（`active` のみ）
  - 呼び出し主体 `actor` が `accounts` D1 上に `active` 所属を持たない場合、たとえ `actor.chapters` に値を詰めて渡しても `{ ok: false, code: "forbidden" }` で拒否される
  - 存在しない `chapterId` を指定しても例外にならず空配列（または存在するチャプター分のみ）を返す
  - `chapterIds` が上限（50 件）を超えると `{ ok: false, code: "too_many_chapters" }` を返す
  - `roles: ["organizer"]` 指定時は `organizer` のみ返り、`member` が混入しない
- **`directory.server.test.ts`**:
  - `ACCOUNTS` 経由の `/api/chapters/directory` レスポンスのパースと `chapterId` の数値変換
  - `ACCOUNTS_DIRECTORY` が `{ ok: false, code }` を返したときにエラーとして扱われ、かつブラウザ向け型 `ChapterSummary` にメールアドレス等の個人情報が一切含まれないこと（Stage 04 の loader 設計でもこの境界を維持する）

### 4. 手動 E2E

本ステージは UI を持たないため、ブラウザ E2E は Stage 04 でまとめて実施する。必要に応じてローカルで `accounts` と `meet` の型生成・ユニットテストの網羅を確認する。