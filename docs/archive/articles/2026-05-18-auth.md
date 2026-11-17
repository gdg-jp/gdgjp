# Cloudflare Workers で動く OIDC SSO を自前で組んだ話

**公開日:** 2026-05-18
**対象読者:** OIDC / OAuth 2.1 を運用したい Web エンジニア、Cloudflare Workers でマルチアプリ構成を作っている人

GDG Japan (`gdgs.jp`) では、5 つの独立した React Router v7 + Cloudflare Workers アプリ
(`accounts` / `tinyurl` / `wiki` / `img` / `scheduler`) を 1 つの IdP に対してシングルサインオンさせている。
本記事ではその認証アーキテクチャを、IdP 側 (`accounts/`) と RP 側 (`gdg-lib/` + 各 RP)
に分けて、コードを引用しながら解説する。

---

## 1. 全体像

```
                  ┌───────────────────────────────────────────────┐
                  │   IdP: accounts.gdgs.jp  (accounts/)          │
                  │                                               │
   Google ─OIDC──▶│  /oauth/google/{start,callback}               │
                  │      └─ openid-client v6 (Google は id_token) │
                  │                                               │
                  │  /authorize ───┐                              │
                  │  /oauth/token  │  ← @cloudflare/              │
                  │  /userinfo  ───┤    workers-oauth-provider     │
                  │                │    (OAuth 2.1 + KV)          │
                  │  /.well-known/openid-configuration            │
                  │  /auth/signout (federated sign-out)           │
                  │                                               │
                  │  IdP セッション: gdgjp-accounts-session       │
                  │      (HMAC 署名 Cookie, 14 日)                │
                  │  ストレージ: D1 (user/chapters) + KV (OAuth)  │
                  └───────────────────────────────────────────────┘
                            ▲
                            │ OIDC (id_token なし) + /userinfo
                            │
   ┌───────────────────────┴───────────────────────────────────────┐
   │   RP × 4: tinyurl / wiki / img / scheduler                     │
   │                                                                │
   │   gdg-lib/src/auth/rp.ts  initializeRpAuth(...)                │
   │      ├─ /api/auth/signin    PKCE authorize リダイレクト        │
   │      ├─ /api/auth/callback  authorization code → /userinfo    │
   │      ├─ /api/auth/signout   IdP の /auth/signout へ 302       │
   │      ├─ /api/auth/me        現在のユーザー (Cookie 検証のみ)  │
   │      ├─ /auth/signout-iframe  (IdP の federated sign-out 用)  │
   │      └─ getFreshClaims()    /userinfo を都度叩く              │
   │                                                                │
   │   RP セッション: gdgjp-<app>-session                          │
   │      (HMAC 署名 Cookie, 30 日, access/refresh token 同梱)      │
   └────────────────────────────────────────────────────────────────┘
```

すべての永続データは Cloudflare の中で完結している。IdP 側は

- **D1** … `user`, `chapters`, `memberships` (ドメインデータ)
- **KV** (`OAUTH_KV`) … OAuth クライアント定義、grant、access/refresh token

RP 側は

- **D1** … `user` テーブルのみ (帰属用)
- セッション/トークンは **HMAC 署名された Cookie** に乗せる (DB セッションテーブルは持たない)

「Workers に閉じた、署名 Cookie 中心、KV に OAuth 状態を寄せる」というのが
このアーキテクチャの軸になっている。

---

## 2. IdP: `accounts/`

### 2.1 なぜ `@cloudflare/workers-oauth-provider` なのか

最初の候補は `panva/node-oidc-provider` だった。しかしこれは Koa に依存しており、
Koa は Node 専用 HTTP フレームワークなので `workerd` 上では動かない。

そこで Cloudflare 公式の `@cloudflare/workers-oauth-provider` を採用した。これは

- OAuth 2.1 サーバの全部入り (authorize / token / PKCE / refresh / クライアント管理)
- ストレージは Workers KV
- `apiRoute` に登録した URL は Bearer トークン検証済みの上で `apiHandler` に流れる

という、Workers ネイティブな OAuth サーバとして書かれている。
ただし **OIDC ではない** — id_token を発行しないし、JWKS や discovery も持たない。
我々は OIDC として振る舞いたかったので、**薄い OIDC レイヤを自前で被せる**ことにした。

### 2.2 OAuthProvider をどう載せるか

Worker のエントリ (`accounts/workers/app.ts`) で `OAuthProvider` が React Router を内包する形にする。

```ts
// accounts/workers/app.ts
const requestHandler = createRequestHandler(
  () => import("virtual:react-router/server-build"),
  import.meta.env?.MODE ?? "production",
);

const rrHandler = {
  fetch(request, env, ctx) {
    return requestHandler(request, { cloudflare: { env, ctx } });
  },
};

function getProvider(env: Env): OAuthProvider<Env> {
  if (providerCache?.appUrl === env.APP_URL) return providerCache.provider;
  const provider = new OAuthProvider<Env>(
    buildOAuthOptions({ appUrl: env.APP_URL, defaultHandler: rrHandler }),
  );
  providerCache = { provider, appUrl: env.APP_URL };
  return provider;
}

export default {
  fetch(request, env, ctx) {
    return getProvider(env).fetch(request, env, ctx);
  },
} satisfies ExportedHandler<Env>;
```

`buildOAuthOptions` のポイントは 3 つ。

```ts
// accounts/app/lib/oauth-provider.server.ts
return {
  authorizeEndpoint: `${base}/authorize`,        // ← defaultHandler に流れる (RR 側で実装)
  tokenEndpoint:     `${base}/oauth/token`,      // ← ライブラリが処理
  apiRoute:          [`${base}/userinfo`],       // ← apiHandler に流れる (Bearer 検証済み)
  apiHandler:        userinfoHandler,
  defaultHandler:    args.defaultHandler,        // ← 上記以外は全部 RR へ
  scopesSupported:   ["openid", "email", "profile", "offline_access"],
  accessTokenTTL:    60 * 60,                    // 1h
  refreshTokenTTL:   60 * 60 * 24 * 30,          // 30d
  allowImplicitFlow: false,
  allowPlainPKCE:    false,
};
```

- `authorizeEndpoint` は **defaultHandler** へ送られる。つまり `/authorize` の UX
  (IdP ログインチェック、未ログインなら `/signin` へ) は自分で React Router のルートに書く。
- `tokenEndpoint` は **ライブラリが完結処理**する。コードを書く必要はない。
- `apiRoute` に登録された URL はライブラリが Bearer トークンを検証し、grant に紐づく
  `props` を `ctx.props` として `apiHandler` に渡してくれる。**これが我々の `/userinfo` の実体**になる。

### 2.3 OIDC 互換レイヤ (約 150 行)

OIDC を名乗るために自前で用意したのは次の 3 つだけ。

1. **discovery エンドポイント** (`/.well-known/openid-configuration`)
2. **/userinfo エンドポイント** (apiHandler として実装)
3. RP 側の `openid-client` への `idTokenExpected: false` 指示

discovery は静的レスポンス。**`id_token_signing_alg_values_supported` と `jwks_uri` を意図的に省略**することで、
「id_token は出さない」ことを正直に表明している。

```ts
// accounts/app/routes/well-known.openid-configuration.ts
return Response.json({
  issuer,
  authorization_endpoint: `${issuer}/authorize`,
  token_endpoint:         `${issuer}/oauth/token`,
  userinfo_endpoint:      `${issuer}/userinfo`,
  scopes_supported:       ["openid", "email", "profile", "offline_access"],
  response_types_supported:           ["code"],
  grant_types_supported:              ["authorization_code", "refresh_token"],
  code_challenge_methods_supported:   ["S256"],
  token_endpoint_auth_methods_supported: ["client_secret_basic", "client_secret_post"],
  subject_types_supported: ["public"],
  // No id_token issuance — intentionally omitted:
  //   id_token_signing_alg_values_supported, jwks_uri
});
```

### 2.4 `/authorize` — IdP セッション × OAuth grant の合流点

`/authorize` は **defaultHandler に流れる** ので、React Router のローダで書いている。
ここでやることは以下:

1. `helpers.parseAuthRequest(request)` で OAuth リクエスト (client_id / redirect_uri / PKCE…) を検証
2. IdP セッション Cookie を読み、未ログインなら `/signin` へ 302
3. ログイン済みなら `helpers.completeAuthorization({ userId, scope, props })` でライブラリに grant を発行させ、
   返ってきた `redirectTo` (RP のコールバック URL + `code`) に 302

```ts
// accounts/app/routes/authorize.tsx (要約)
let authReq;
try {
  authReq = await helpers.parseAuthRequest(request);
} catch (err) {
  // KV が空 (cold start, CI, 新環境) や redirect_uri 変更時に
  // ここで "Invalid client" になる。一度だけ seedClients を試みてリトライする。
  if (isUnknownClientError(err) || isRedirectMismatchError(err)) {
    await seedClients(env);
    authReq = await helpers.parseAuthRequest(request);
  } else throw err;
}

const session = await readIdpSession(request, env.IDP_SESSION_SECRET);
if (!session) {
  throw redirect(`/signin?return_to=${encodeURIComponent(currentPath)}`);
}

const row = await env.DB.prepare(
  `SELECT id, email, name, image, is_admin FROM "user" WHERE id = ? LIMIT 1`,
).bind(session.userId).first();

const { redirectTo } = await helpers.completeAuthorization({
  request: authReq,
  userId: row.id,
  scope: authReq.scope,
  metadata: {},
  props: { sub: row.id, email: row.email, name: row.name, picture: row.image, isAdmin: row.is_admin === 1 },
});
throw redirect(redirectTo);
```

ここで `props` に詰めた内容は、後で `/userinfo` を呼ばれた際に `ctx.props` として読める。
**「grant 発行時のスナップショット」を grant 自体に同梱できる**のがこのライブラリの便利な点だ。

`/authorize` のもう一つの工夫は **「KV が空でも詰まらない」フォールバック**。`OAUTH_KV` が空の状態でも、
最初の `/authorize` 呼び出しが自動で `seedClients(env)` を実行してクライアント定義を流し込む。
これにより「クライアント登録するにはサインインが必要、サインインするにはクライアント登録が必要」という
chicken-and-egg を回避している。

### 2.5 `/userinfo` — grant の props は使うが、可変フィールドは毎回 D1 再読込

ここがアーキテクチャ上重要な選択。

```ts
// accounts/app/lib/oauth-provider.server.ts
const userinfoHandler: HandlerWithFetch = {
  async fetch(_request, env, ctx) {
    const props = (ctx as ExecutionContext & { props?: GrantProps }).props;
    if (!props) return json({ error: "no_props" }, 500);

    // grant の props にも email/name/picture/isAdmin はあるが、
    // refreshTokenTTL = 30 日もの間 stale になり得るので毎回 D1 を再読込する。
    const row = await env.DB.prepare(
      `SELECT email, name, image, is_admin FROM "user" WHERE id = ? LIMIT 1`,
    ).bind(props.sub).first();
    if (!row) {
      // ユーザーが grant 後に削除された → 実質トークン失効
      return json({ error: "user_not_found" }, 401);
    }
    const chapters = await listActiveChaptersForUser(env.DB, props.sub);
    const primary = chapters[0] ?? null;
    return json({
      sub: props.sub,
      email: row.email,
      name: row.name,
      picture: row.image,
      email_verified: true,
      isAdmin: row.is_admin === 1,
      chapterId: primary?.chapterId ?? null,
      chapterSlug: primary?.chapterSlug ?? null,
      chapterRole: primary?.role ?? null,
      chapters: chapters.map((c) => ({ chapterId: c.chapterId, chapterSlug: c.chapterSlug, role: c.role })),
    });
  },
};
```

`isAdmin` のような **権限フィールドを grant に固定すると、降格が grant TTL の最大 30 日反映されない**。
grant に固定するのは `sub` (= 不変な local user id) だけにし、可変な属性は毎回 D1 から取り直すことで
「降格は即時反映」「ユーザー削除はトークン即失効」を実現している。

### 2.6 IdP セッション — better-auth のテーブルを捨て、署名 Cookie ひとつに

IdP のログイン UI 用セッションは **DB に持たず、HMAC 署名された Cookie ひとつ** で表現している。

```ts
// accounts/app/lib/idp-session.server.ts
const COOKIE_NAME = "gdgjp-accounts-session";
const MAX_AGE_S = 60 * 60 * 24 * 14; // 14 days

interface IdpSessionPayload {
  userId: string;
  email: string;
  isAdmin: boolean;
  exp: number;
}

export async function readIdpSession(request, secret) {
  const value = readCookie(request, COOKIE_NAME);
  if (!value) return null;
  const payload = await verifyPayload<IdpSessionPayload>(value, secret);
  if (!payload || payload.exp < Math.floor(Date.now() / 1000)) return null;
  return payload;
}
```

`signPayload` / `verifyPayload` は `gdg-lib/src/auth/cookie.ts` の WebCrypto ベースの
HMAC-SHA256 実装で、IdP / RP の両方で同じ関数を使っている。

```ts
// gdg-lib/src/auth/cookie.ts (抜粋)
export async function signPayload<T>(payload: T, secret: string): Promise<string> {
  const key = await importKey(secret);
  const body = b64urlEncode(encoder.encode(JSON.stringify(payload)));
  const sig = new Uint8Array(await crypto.subtle.sign(ALG, key, encoder.encode(body)));
  return `${body}.${b64urlEncode(sig)}`;
}
```

Cookie に乗るのは `body.sig` の形 (≒ JWT の HS256 をフラットにしたもの)。
本物の JWT を使わないのは「ヘッダ JSON を毎回シリアライズしたくない」「`alg` 攻撃の余地を最初から作らない」
という小さな最適化と防御のため。

### 2.7 Google 上流ログイン — Google だけは id_token を使う

`workers-oauth-provider` は id_token を出さないが、**上流の Google は id_token を出す**。
ここだけは `openid-client` v6 を素直に OIDC モードで使い、`tokens.claims()` から `sub` / `email` を取る。

```ts
// accounts/app/lib/google.server.ts (要約)
const tokens = await oidc.authorizationCodeGrant(config, new URL(args.request.url), {
  pkceCodeVerifier: tx.codeVerifier,
  expectedState:    tx.state,
  expectedNonce:    tx.nonce,
  idTokenExpected:  true,   // ← Google なので true
});

const claims = tokens.claims();
if (typeof claims.email !== "string" || claims.email.length === 0) {
  // email スコープを要求しているので、欠落・空はエラー。
  // empty string を許すと user.email NOT NULL UNIQUE に複数衝突する。
  throw new Error("Google id_token missing email claim");
}
```

注意点として **「email が string なら OK」と書くと空文字も通ってしまう**。
2 人目の空メールアカウントが UNIQUE 制約で死ぬので、`length > 0` を必ず明示する。

### 2.8 オープンリダイレクト対策

`/oauth/google/start?return_to=...` のような「サインイン後の戻り先 URL」パラメータは、
そのまま使うと **オープンリダイレクト→セッション付与の攻撃面** になる。
`safeReturnTo` で「同一オリジンの相対パスか、信頼された `*.gdgs.jp` のみ」に限定している。

```ts
// accounts/app/routes/oauth.google.start.ts
const returnTo = safeReturnTo(url.searchParams.get("return_to")) ?? "/dashboard";
```

これは `signin.tsx` も同じ契約で使っており、IdP 内で URL のホワイトリスト判定を一本化している。

---

## 3. RP 側: `gdg-lib/src/auth/rp.ts` ひとつで完結

4 つの RP (`tinyurl`, `wiki`, `img`, `scheduler`) はすべて、`@gdgjp/gdg-lib` の
**`initializeRpAuth({ db, appUrl, cookiePrefix, secret, idp })`** を呼び出すだけで認証が組み上がる。

RP 側のコード量は驚くほど少ない。`tinyurl` を例にすると:

```ts
// tinyurl/app/lib/auth.server.ts (全文)
import { type RpAuthInstance, initializeRpAuth } from "@gdgjp/gdg-lib";

let cached: { instance: RpAuthInstance; env: Env } | null = null;

export function getAuth(env: Env): RpAuthInstance {
  if (cached?.env === env) return cached.instance;
  const instance = initializeRpAuth({
    db:           env.DB,
    appUrl:       env.APP_URL,
    cookiePrefix: "gdgjp-tinyurl",
    secret:       env.RP_SESSION_SECRET,
    idp: {
      url:          env.IDP_URL,
      clientId:     env.IDP_CLIENT_ID,
      clientSecret: env.IDP_CLIENT_SECRET,
    },
  });
  cached = { instance, env };
  return instance;
}
```

```ts
// tinyurl/app/routes/api.auth.$.ts (全文)
export async function loader(args)  { return getAuth(args.context.cloudflare.env).handleAuthRequest(args.request); }
export async function action(args)  { return getAuth(args.context.cloudflare.env).handleAuthRequest(args.request); }
```

```ts
// tinyurl/app/routes/auth.signout.ts (全文)
export function loader({ request, context }) {
  return getAuth(context.cloudflare.env).handleSignOutRedirect(request);
}
```

これだけで `/api/auth/{signin,callback,signout,me}` と `/auth/signout`,
`/auth/signout-iframe` が動く。

### 3.1 サインイン — PKCE + state + nonce + tx Cookie

`handleSignIn` は openid-client v6 の primitives を組み合わせて authorize URL を作り、
**PKCE verifier と state/nonce/return_to を「tx Cookie」として 10 分間 HMAC 署名して持ち回す**。
サーバ側で transaction state を保持しないので、Workers の thin な実行モデルと相性が良い。

```ts
// gdg-lib/src/auth/rp.ts (handleSignIn 要約)
const codeVerifier  = oidc.randomPKCECodeVerifier();
const codeChallenge = await oidc.calculatePKCECodeChallenge(codeVerifier);
const state         = oidc.randomState();
const nonce         = oidc.randomNonce();

const authUrl = oidc.buildAuthorizationUrl(issuerConfig, {
  redirect_uri:          callbackUrl(config),
  scope:                 "openid email profile offline_access",
  code_challenge:        codeChallenge,
  code_challenge_method: "S256",
  state, nonce,
});

const tx: TxPayload = { codeVerifier, state, nonce, returnTo, exp: Date.now() + TX_MAX_AGE_S * 1000 };
const txCookie = serializeCookie({
  name:    txCookieName(config),
  value:   await signPayload(tx, config.secret),
  maxAge:  TX_MAX_AGE_S,
  secure:  !isLocalAppUrl(config.appUrl),
});
```

### 3.2 コールバック — `idTokenExpected: false` と `/userinfo`

`handleCallback` でコードをトークンに交換し、その access_token で `/userinfo` を叩く。
**ここが最初の落とし穴で、デフォルトの `idTokenExpected: true` のままだと毎回失敗する**
(`workers-oauth-provider` は id_token を出さない)。

```ts
// gdg-lib/src/auth/rp.ts (handleCallback 要約)
const tokens = await oidc.authorizationCodeGrant(issuerConfig, url, {
  pkceCodeVerifier: tx.codeVerifier,
  expectedState:    tx.state,
  idTokenExpected:  false,   // ← workers-oauth-provider は id_token を出さない
  // expectedNonce: なし — id_token がないので検証対象がない
});

const userClaims = await fetchUserinfoClaims(issuerConfig, tokens.access_token);
const internalUserId = await upsertUser(config.db, userClaims);

const session: SessionPayload = {
  userId:               internalUserId,
  email:                userClaims.email ?? "",
  name:                 userClaims.name ?? userClaims.email ?? "",
  picture:              userClaims.picture,
  isAdmin:              userClaims.isAdmin,
  accessToken:          tokens.access_token,
  refreshToken:         tokens.refresh_token ?? null,
  accessTokenExpiresAt: Date.now() + (tokens.expires_in ?? 3600) * 1000,
  chapters:             userClaims.chapters,
  claimsCacheUntil:     Date.now() + CLAIMS_CACHE_MS,
};
```

セッション Cookie は **access_token / refresh_token を含めて HMAC 署名**された 30 日 Cookie。
DB 側にセッション/トークンテーブルは無い。

### 3.3 `upsertUser` — IdP の sub は使わない

地味だが効いている設計。**ローカル `user.id` には IdP の `sub` をそのまま使わず、
email でローカルを検索してマッチすれば既存 UUID を維持、初回ログインなら新 UUID を発行**する。

```ts
// gdg-lib/src/auth/rp.ts (upsertUser 要約)
const existing = await db.prepare(`SELECT id FROM "user" WHERE email = ? LIMIT 1`)
  .bind(email).first<{ id: string }>();

if (existing) {
  await db.prepare(`UPDATE "user" SET name = ?, image = ?, is_admin = ?, updated_at = ? WHERE id = ?`)
    .bind(name, image, isAdmin, now, existing.id).run();
  return existing.id;
}
const id = crypto.randomUUID();
await db.prepare(
  `INSERT INTO "user" (id, email, name, image, is_admin, created_at, updated_at)
   VALUES (?, ?, ?, ?, ?, ?, ?)`,
).bind(id, email, name, image, isAdmin, now, now).run();
return id;
```

これにより `img.images.user_id` のような **歴史的な user_id 参照を、データ移行なしで温存**できる。
副作用として「RP のローカル user.id は IdP の sub と一致しない」という事実が生まれるので、
次の `getFreshClaims` で配慮が必要になる。

### 3.4 `getFreshClaims` — `fetchUserInfo` ではなく `fetchProtectedResource`

`getFreshClaims` は「いま現在の chapter membership や isAdmin がほしい」というユースケースのために、
署名 Cookie 上の access_token を取り出し、必要なら refresh して、`/userinfo` を叩く。

ここで `openid-client` の `fetchUserInfo` を使うと **`expectedSub` の不一致で必ず失敗する**。
理由は上で書いた通り、ローカル `session.userId` は IdP の `sub` と一致しないため。

```ts
// gdg-lib/src/auth/rp.ts (fetchUserinfoClaims 要約)
const res = await oidc.fetchProtectedResource(
  issuerConfig,
  accessToken,
  new URL(userinfoEndpoint),
  "GET",
);
```

`fetchProtectedResource` は `sub` 一致チェックを行わず、単に Bearer 付きで GET するだけ。
**「同じ IdP から得た Bearer なので、その IdP の `/userinfo` の応答は信頼してよい」**
という当たり前の前提を取り戻している。

ついでにこのレイヤでは

- **inflight de-dup** (同じ userId に対する同時 `/userinfo` 呼び出しを 1 本化)
- **access_token の TTL 30s 手前で refresh**
- 5 分間の claims キャッシュ (`claimsCacheUntil`) ヒント

を行っている。Cookie が Response context の外でしか書けないので、refresh 後の access_token は
**「このリクエスト中だけ in-memory で使う」**にとどめている。

### 3.5 RP の Cookie だけ少しオプションが多い

```ts
{
  userId, email, name, picture, isAdmin,
  accessToken, refreshToken, accessTokenExpiresAt,
  chapters, claimsCacheUntil,
}
```

`isAdmin` がここに固定されているのは、`getSessionUser` を **DB に当てずに済ませる**ためのもの。
ただし stale になりうるので、権限判定が必要なところでは `getFreshClaims()` 経由で再取得するか、
IdP 側 `/userinfo` で都度 D1 を読む設計と合わせ技で「最大でも `/userinfo` 1 ホップで最新化できる」状態を作っている。

---

## 4. フェデレーテッドサインアウト

ユーザーが任意の RP で「サインアウト」を押すと:

1. RP: `/api/auth/signout` → 自分のセッション Cookie をクリアしつつ、
   `Location: ${IDP}/auth/signout?return_to=${RP}/signin` に 302
2. IdP `/auth/signout`: **IdP セッション Cookie をクリア**し、HTML を返す。
   その HTML には **各 RP の `/auth/signout-iframe` を指す display:none な iframe** が並んでいる。
3. 各 RP `/auth/signout-iframe`: 自分の Cookie をクリアして 200 を返すだけ。
   CSP で `frame-ancestors` を IdP オリジンに限定。
4. IdP HTML 内の JS: 全 iframe の load/error を待って、最終 `return_to` に `location.replace`。
   タイムアウト 3 秒のフォールバックあり。

IdP 側:

```ts
// accounts/app/lib/federated-signout.server.ts (renderFederatedSignOutPage 抜粋)
const iframes = iframeUrls.map((u) =>
  `<iframe src="${escapeHtml(u)}" referrerpolicy="no-referrer" style="display:none" aria-hidden="true"></iframe>`
).join("");
return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8" /><title>Signing out…</title><meta name="robots" content="noindex" /></head>
<body>
<p>Signing out…</p>
${iframes}
<script>
(function () {
  var done = false, total = ${iframeUrls.length}, loaded = 0;
  function go() { if (done) return; done = true; window.location.replace(${JSON.stringify(target)}); }
  if (total === 0) { go(); return; }
  document.querySelectorAll('iframe').forEach(function (f) {
    var settle = function () { loaded += 1; if (loaded >= total) go(); };
    f.addEventListener('load',  settle, { once: true });
    f.addEventListener('error', settle, { once: true });
  });
  setTimeout(go, ${timeoutMs});
})();
</script>
</body></html>`;
```

RP 側:

```ts
// gdg-lib/src/auth/rp.ts (handleSignOutIframe 抜粋)
const csp = frameAncestorsCsp(config.idp.url, request.url);
const headers = new Headers({
  "Content-Type":            "text/html; charset=utf-8",
  "Cache-Control":           "no-store",
  "Content-Security-Policy": csp,            // ← IdP 以外からの埋め込み禁止
  "Referrer-Policy":         "no-referrer",
  "Set-Cookie":              clearedCookie(sessionCookieName(config)),
});
```

iframe 経由のサインアウトはレガシーな手法だが、

- ブラウザを跨ぐサードパーティ Cookie 規制下でも、**iframe からは「自分のオリジンの Cookie をクリア」する分には支障がない**
- 全 RP を OIDC RP-Initiated Logout 仕様に揃えるより、`Set-Cookie` 1 行で済む iframe ペイロードのほうが運用が単純

という理由で採用している。

---

## 5. シーケンスで見るサインインフロー

`tinyurl` で未ログインのユーザーが `/links` にアクセスしたとして:

```
Browser           tinyurl                 accounts (IdP)             Google
  │                  │                        │                        │
  ├─GET /links──────▶│                        │                        │
  │                  │ requireUser → 401      │                        │
  │◀─302 /signin?return_to=/links             │                        │
  ├─GET /signin─────▶│                        │                        │
  │◀─302 /api/auth/signin?return_to=/links    │                        │
  ├─GET /api/auth/signin────────────────────▶                          │
  │                  │ PKCE 生成 / state / nonce / tx Cookie 署名     │
  │◀─302 https://accounts.gdgs.jp/authorize?...─                        │
  │                                          │                         │
  ├─GET /authorize───────────────────────────▶│ parseAuthRequest        │
  │                                          │ IdP Cookie なし          │
  │◀─302 /signin?return_to=/authorize?...    │                         │
  ├─GET /signin─────────────────────────────▶│                         │
  │ (Google ボタン)                           │                         │
  ├─GET /oauth/google/start?return_to=...───▶│ PKCE/state/nonce + tx   │
  │◀─302 https://accounts.google.com/...─────                          │
  ├──────────Google サインイン UI────────────────────────────────────────▶│
  │◀─302 .../oauth/google/callback?code=...──────────────────────────────│
  ├─GET /oauth/google/callback──────────────▶│ code→id_token 交換       │
  │                                          │ email→D1 で user upsert  │
  │                                          │ IdP セッション Cookie 発行│
  │◀─302 /authorize?... (戻る)                │                         │
  ├─GET /authorize──────────────────────────▶│ parseAuthRequest         │
  │                                          │ IdP Cookie あり          │
  │                                          │ completeAuthorization    │
  │                                          │   props={sub,email,...}  │
  │◀─302 https://tinyurl.gdgs.jp/api/auth/callback?code=...─             │
  ├─GET /api/auth/callback?code=──▶│         │                         │
  │                  │ authorizationCodeGrant(idTokenExpected:false)──▶│ (KV から code 検証 + access/refresh 発行)
  │                  │ /userinfo (Bearer) ──────────────────────────▶│ apiHandler: props.sub から D1 再読込
  │                  │ ◀── { sub, email, name, isAdmin, chapters }──│
  │                  │ upsertUser by email                            │
  │                  │ 署名 Cookie (30d) 発行                          │
  │◀─302 /links ──────                       │                         │
```

ポイント:

- **PKCE は 2 回登場する**: RP→IdP の OAuth 2.1 と、IdP→Google の OIDC で別個に動く。
- **id_token は Google→IdP の 1 ホップだけ**。IdP→RP は OAuth 2.1 で、属性は `/userinfo` 経由。
- **D1 は IdP の `/userinfo` 内で 1 回、RP の `upsertUser` で 1 回読み書きされる**。
  どちらも email がキー。

---

## 6. 設計のサマリ

| 項目 | 採用した方針 | なぜ |
|---|---|---|
| OAuth サーバ | `@cloudflare/workers-oauth-provider` | Workers ネイティブ。Koa 依存のライブラリは workerd で動かない |
| OIDC 互換 | 自前で薄く (約 150 行) | discovery + `/userinfo` だけ書けば十分。id_token は不要 |
| ストレージ分離 | KV = OAuth 状態, D1 = ドメイン | ライブラリ要求 (KV のみ) と、ドメインの SQL クエリ性を両立 |
| IdP セッション | HMAC 署名 Cookie 1 本, 14d | DB セッションテーブルを持たないので migrate もスケールも単純 |
| RP セッション | HMAC 署名 Cookie 1 本, 30d | 同上。access/refresh も同梱 |
| 権限の鮮度 | `/userinfo` で都度 D1 再読込, RP 側で 5 分キャッシュ | 降格を 30 日 (refresh TTL) も待たない |
| `user.id` | RP 側は email lookup で UUID 維持 | 既存 `*.user_id` 参照を温存、`sub` 直接利用を避ける |
| `/userinfo` 取得 | `fetchProtectedResource` (sub 検証なし) | local id ≠ IdP sub なので `fetchUserInfo` は使えない |
| サインアウト | IdP からの iframe による federated logout | サードパーティ Cookie 規制でも動く最小実装 |
| ローカル http 対応 | `oidc.allowInsecureRequests` を localhost のみ許可 | openid-client v6 は HTTPS 必須 |
| Cookie 形式 | `body.sig` (フラットな HS256) | JWT のヘッダ攻撃面を最初から消す |
| OAuth client 登録 | `seedClients` (admin route + authorize-time フォールバック) | KV 空の cold start でも chicken-and-egg にならない |

---

## 7. おわりに

「OIDC を名乗りつつ、必要最小限の OIDC 機能 (= discovery + `/userinfo`) しか出さない」
「サーバ側に session/transaction state を持たない」というラインを引くと、
Cloudflare Workers 上の SSO は **ライブラリ 1 本 (`workers-oauth-provider`) + 自作 ~300 行** で組める。

その代わり、

- **id_token を信用しない**前提のコード (`idTokenExpected: false`, `fetchProtectedResource`)
- **grant の props は信用するが、可変フィールドは毎回 D1 を読む**設計
- **HMAC 署名 Cookie 1 本で transaction も session も表現する**割り切り

といった、フレームワークが暗黙にやってくれていた部分を **明示的に書く必要がある**。
逆に言えば、そこさえ書ききってしまえば、5 つのアプリすべてに対して

```ts
const auth = initializeRpAuth({ db, appUrl, cookiePrefix, secret, idp });
```

の 1 行で SSO が乗る。RP 側の認証コードは合計 50 行に満たない。
このシンプルさが、Workers と OIDC の組み合わせで自前 SSO を組む最大の見返りだと思う。
