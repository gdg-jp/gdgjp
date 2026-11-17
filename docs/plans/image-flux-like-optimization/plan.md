# img.gdgs.jp: ImageFlux 相当の自動画像最適化

## Context

`img.gdgs.jp/<id>` は現在、クエリパラメータが無いときは R2 のオリジナルバイトをそのまま返している
（`img/app/routes/$id.tsx`）。`?w=&h=&fit=&q=&f=` を付けたときだけ Cloudflare Images バインディング
経由で変換される。つまり Web ページや Slack に貼られた素の URL は、10 MiB 近い PNG がそのまま配信され
うる状態で、転送量・表示速度の両面で損をしている。

さくらの ImageFlux のように「URL を変えずに、勝手に軽くなっている」状態にする。

ユーザー確定事項:

1. **素の URL も自動最適化する。** Accept ネゴシエーションで AVIF/WebP へ再エンコードし、上限幅まで
   縮小する。オリジナルは明示的なエスケープハッチ (`?f=original`) で取得できる。
2. **変換結果は R2 に永続化する。** Cloudflare Images の変換は課金対象なので、(ソース, パラメータ) の
   組み合わせごとに変換は最大 1 回にする。
3. **スコープは配信時の最適化 + ダッシュボードの URL ビルダー UI のみ。**
   アップロード時の原本圧縮と `gdg img optimize` CLI は対象外。

期待する結果: 既存の URL を一切変えずに配信バイト数が大きく減り、埋め込み用の最適化 URL を管理画面から
組み立てられるようになる。

---

## 設計の骨子

### 1. 派生物の保存先: 新しい R2 バケット `DERIVED`

`ORIGINALS` にプレフィックスを切るのではなく、**別バケット `gdgjp-img-derived`** を追加する。
派生物は使い捨てで、ライフサイクルルールと `list({prefix})` の一括削除を回すことになる。その 2 つを
「原本の唯一のコピー」が入っているバケットに向けるのは、ストレージ削減のために取るリスクとして割に
合わない。バケットを分ければライフサイクルはバケット全体に掛けられ、掃除ミスが無害になり、コストも
分離して見える。

`img/wrangler.toml` に追加し、`pnpm --filter @gdgjp/img cf-typegen` を回す:

```toml
[[r2_buckets]]
binding = "DERIVED"
bucket_name = "gdgjp-img-derived"
```

### 2. 派生物のキー形式

```
<id>/<v>/<sourceVersion>/<schema>_<paramSlug>.<ext>
```

例: `Ab3dEf9h/d/1735689600/1_w1600_scale-down_q82.avif`

| セグメント | 値 | 理由 |
| --- | --- | --- |
| `<id>` | 8 文字の image id（slug は使わない） | `list({prefix: \`${id}/\`})` で 1 画像分を掃除できる。slug 改名で孤児が出ない |
| `<v>` | `d` / `m` | default と mobile のソースを分離 |
| `<sourceVersion>` | `d` は `image.updatedAt`、`m` は `image.mobileUpdatedAt` | **無効化が構造的に自動になる**（下記） |
| `<schema>` | 定数 `1` | 幅ラダーや既定品質の意味を変えたら定数を上げるだけで全派生物が到達不能になる |
| `<paramSlug>` | `w{W}[_h{H}]_{fit}_q{Q}` を固定順で | 決定的（§3） |
| `<ext>` | `avif` / `webp` / `jpg` / `png` | 解決済み出力フォーマット |

**無効化。** `replaceImageForActor` は `r2Key` を再利用するが `updateImageBytes` が `updated_at` を
更新するので、置換すれば `sourceVersion` が変わり古い派生物は到達不能になる。無効化パスは不要。
逆に `setImageSlug` / `setImageFolder` / `setImageChapter` / `updateImageAttributes` が意図的に
`updated_at` を上げない既存の不変条件が、ETag だけでなく **R2 ストレージも守る** ようになる。
`img/CLAUDE.md` に一文足すこと。

既知の粗さ（コメントに残す・今は直さない）: モバイル画像のアップロードは行の `updated_at` も上げるため、
default 側の派生物まで無効化する。過剰無効化なので安全側。直すなら `bytes_updated_at` 列の追加になる。

**掃除。**

- 画像削除: `deleteImageForActor` は既に `ctx` を持つ。`ctx.waitUntil(deleteRenditionsForImage(env, id))`
  を追加。`DERIVED.list({prefix})` をページングして `delete(keys[])`（1000 件ずつ）。ここは list 掃引が必須
  — 派生物の一覧は他のどこにも記録されていない。
- 置換 / モバイル置換 / モバイル削除: `sourceVersion` により既に到達不能なので正しさのためには不要。
  ただしベストエフォートで旧 `sourceVersion` プレフィックスを掃く。**`replaceImageForActor` と
  `setMobileImageForActor` は現在 `ctx` を受け取っていない** ので `ctx: ExecutionContext` を追加し、
  呼び出し元 4 箇所（`api.replace.$id.ts`, `api.mobile.$id.ts`, `api.cli.v1.images.$id.ts`,
  `api.cli.v1.images.$id.mobile.ts`）を更新する。
- **R2 ライフサイクルルール**（`wrangler r2 bucket lifecycle add`、`wrangler.toml` では設定できない）:
  作成 30 日後に削除 + 未完了マルチパートの中断。これが総量を縛る最終的な歯止め。30 日以上ホットな派生物は
  月 1 回だけ再変換される（誤差）。PR 説明に明記すること。

### 3. 正規化 (`app/lib/img-transform.ts`, 純関数)

```ts
export const SCHEMA_VERSION = 1;
export const WIDTH_LADDER = [160, 320, 480, 640, 768, 960, 1200, 1600, 2048, 2560, 3200, 4096];
export const DEFAULT_QUALITY = 82;
export const DEFAULT_FIT = "scale-down";
export const MIN_TRANSFORM_BYTES = 10 * 1024;
export const MAX_DPR = 3;

export type DeriveTransform = { width?: number; height?: number; fit: Fit; quality: number;
                                format: "avif" | "webp" | "jpeg" | "png" };
export type ResolvedDelivery =
  | { kind: "passthrough"; reason: "explicit-original" | "svg" | "animated" | "too-small" }
  | { kind: "derive"; transform: DeriveTransform; canonical: boolean; formatNegotiated: boolean };

export function resolveDelivery(input: {
  params: TransformOpts; accept: string; autoMaxWidth: number;
  source: { contentType: string; byteSize: number; width: number | null; height: number | null };
}): ResolvedDelivery;
export function negotiateFormat(accept: string, sourceContentType: string): DeriveTransform["format"];
export function snapWidth(requested: number): number;   // ラダーに切り上げ
export function renditionParamSlug(t: DeriveTransform): string;
export function isCanonical(t: DeriveTransform): boolean;
```

**決定性。** `renditionParamSlug` は既定値を全て埋めた構造体から固定順で出力する。`?w=800&q=80` と
`?q=80&w=800` は同一のキー・キャッシュキー・ETag を生む。クエリ順は一切効かない。

**`dpr`（新規パラメータ）.** `[1, MAX_DPR]` にクランプ、小数可。ラダー適用の**前**に乗算で畳み込む:
`w_eff = snapWidth(round(w * dpr))`。**`dpr` は明示的な `w`/`h` にしか掛けない** — `?dpr=3` 単独で
`autoMaxWidth` を 3 倍できてしまうと上限の意味がなくなる。畳み込まれるのでキーには現れない
（`?w=800&dpr=2` と `?w=1600` は同じ派生物）。

**`f=original`.** `img-url.ts` の `f` enum に `"original"` を追加。他の全パラメータを無視して
`{kind:"passthrough", reason:"explicit-original"}` に短絡する。「アップロードしたバイトそのもの」の意味。

**素の URL の既定ポリシー:**

- 幅: `autoMaxWidth`（後述の var、初期リリースでは無効）を `fit: "scale-down"` で。`scale-down` は
  拡大しないので、`images.width` が NULL の既存行でも安全。`source.width` が既知で上限以下なら
  `width` を transform から落とす（フォーマット変換のみ）。
- 品質: `DEFAULT_QUALITY = 82`。フォーマット別テーブルはキー空間を 3 倍にする割に効果が薄いので単一値。
- フォーマット: `negotiateFormat` — Accept に `image/avif` → avif、`image/webp` → webp、
  それ以外は **ソースが `image/png` なら png、それ以外は jpeg**。
  **これは現行 `$id.tsx` の `formatFor()` のバグ修正**: 現在は無条件に jpeg へ落ちるため、
  `Accept: */*` で来るクローラや Slack/Discord の unfurler、curl に対して透過 PNG のアルファを
  黙って潰す。§8 の互換性リスクと同じコミットで直すこと。
- 拡大しない: `source.width` が既知なら解決後の幅をそれ以下にクランプ。

**canonical 集合（永続化ゲート）.** `isCanonical(t)` は
`fit === DEFAULT_FIT && quality === DEFAULT_QUALITY && height === undefined && WIDTH_LADDER.includes(width)`。
永続化されるのはこれを満たすものだけ。1 ソースあたり最大 `12 幅 × 4 形式 = 48` オブジェクトに決定的に
収まる。非 canonical なリクエストも普通に変換して返す（エッジキャッシュも効く）が、R2 には書かない。
これが派生物スパムに対する主防御。

### 4. Images バインディングを完全に迂回するケース

`resolveDelivery` の中で R2/Images に触る前に判定する（下 2 つは実行時）。

| ケース | 判断 | 理由 |
| --- | --- | --- |
| `image/svg+xml` | passthrough | バインディングが変換できない。`Vary: Accept` も付けない |
| `image/gif` | 既定は passthrough、明示的な `f=webp\|jpeg\|png` のみ許可 | AVIF はアニメーションを保持できず、自動変換すると animated GIF を黙って壊す。`negotiateFormat` は gif ソースに対して avif を返してはならない |
| `byteSize < MIN_TRANSFORM_BYTES` | **自動パスのみ** passthrough | 4 KB のアイコンは自前の PNG に勝てない。明示パラメータは常に尊重 |
| 変換後 ≥ ソースバイト数 | 自動パスならオリジナルを返し **passthrough マーカー**を書く | 下記 |
| `env.IMAGES` が throw | オリジナルを返す。**絶対に 500 にしない** | 下記 |

**「変換したら太った」。** 永続化のためどのみちバッファするので（10 MiB 上限、Worker メモリ的に安全）、
`bytes.byteLength >= source.byteSize` かつ自動パス（明示的な `w`/`h`/`fit`/`q`/`f` が無い）なら
オリジナルを返す。自動パスの契約は「同じ絵で、より少ないバイト」なのでフォールバックが契約の履行にあたる。
明示パスでは要求された寸法・形式を返す。

毎回のコールドヒットで再発見しないよう、派生キーに `customMetadata: { passthrough: "1" }` の
**0 バイトマーカー**を書く。次のリクエストは 1 回の `DERIVED.get()` でそれを見つけてオリジナルを流す。

**`ImagesError`。** 素の URL がこの経路を通るようになるので、変換失敗が昨日まで動いていた URL を
500 にしてはならない。derive の試行全体（`ORIGINALS.get` → transform → バッファ）を 1 つの
try/catch で包み、**あらゆる throw** でオリジナルを passthrough ETag 付きで返し `console.error` する。
マーカーを書くのは **`err.code === 9412`（not an image）のような恒久的失敗のときだけ** —
一時的な失敗で書くと、一度のブリップで画像が永久に未最適化に固定される。ここは専用のコメントブロックを
付ける価値がある、この変更で最も重要な耐障害性。

### 5. `$id.tsx` のリクエストフロー

```
loader(args):
  env = args.context.cloudflare.env
  ctx = args.context.cloudflare.ctx          // workers/context.ts の CloudflareContext
  1. image = isValidImageId(param) ? getImage(...) : getImageBySlug(...)      [変更なし]
     canonicalLink                                                            [変更なし]
  2. source   = selectSourceVariant(image, url, request.headers)
                -> { r2Key, contentType, byteSize, width, height, variant, sourceVersion, deviceVary }
  3. params   = parseTransformOpts(url)          // +dpr, +f=original
  4. delivery = resolveDelivery({ params, accept, autoMaxWidth, source })     // 純関数
  5. etag     = deliveryEtag(image.id, source, delivery)
  6. If-None-Match 一致 -> 304（R2 を読む前、現行どおり）
  7. return deliverImage({ env, ctx, image, source, delivery, etag, ... })
```

`deliverImage`（`app/features/images/delivery.server.ts`）:

```
  8. passthrough -> ORIGINALS.get(source.r2Key).body をそのまま
  9. cacheKey = new Request(renditionCacheUrl(origin, ...))
     cache.match -> ヒットなら ETag/Vary を付け直して返す
 10. obj = DERIVED.get(renditionKey(...))
       - customMetadata.passthrough === "1" -> オリジナルを流す
       - それ以外 -> obj.body で返し、ctx.waitUntil(cache.put(cacheKey, clone))
 11. ミス -> ORIGINALS.get -> IMAGES.input().transform().output() -> arrayBuffer
       サイズガード(§4) -> レスポンス（Content-Length 付き）
       ctx.waitUntil(Promise.all([
         delivery.canonical ? putRendition(...) : noop,
         cache.put(cacheKey, clone),
       ]))
     10-11 全体を try/catch し、失敗時は passthrough フォールバック
```

**ETag（正確な形）.** `"<id>-<variant>-<sourceVersion>-<tag>"`、`variant` は `d`/`m`、`tag` は derive なら
`paramSlug + "." + ext`、passthrough ならリテラル `orig`。

```
"Ab3dEf9h-d-1735689600-w1600_scale-down_q82.avif"
"Ab3dEf9h-d-1735689600-orig"
```

**ネゴシエートされたフォーマットを ETag に必ず含めること。** 含めないと、AVIF を受け取ったクライアントが
AVIF を受け付けない文脈から再検証したときに偽の 304 が返り、画像が表示されなくなる。ここが一番踏みやすい罠。

**`Vary`.** 現行の組み立てを踏襲しつつ、素の URL がネゴシエートするようになるので `Accept` が既定で入る。

- `f` が具体的なフォーマットまたは `original`、あるいは svg passthrough のときは `Accept` を入れない
  （実際に Accept に依存しないため）。
- 既存の `DEVICE_VARY`（`Sec-CH-UA-Mobile, CF-Device-Type, User-Agent`）は、モバイル派生があり
  明示要求されていないときに従来どおり付ける。
- 最悪ケースは `Vary: Accept, Sec-CH-UA-Mobile, CF-Device-Type, User-Agent`。`User-Agent` だけで
  ほぼクライアント単位キャッシュになる劣悪なキーで、**これが Cache API 層を入れる理由そのもの**。
  そうコメントに書くこと（さもないと「CDN の前になぜキャッシュ？」と次の読者が当然思う）。

**Cache API のキーは Vary の曖昧さを構造的に回避する。** ネゴシエート結果を全部含んだ合成 URL を使う:

```
https://<origin>/_cache/1/<id>/<d|m>/<sourceVersion>/<paramSlug>.<ext>
```

（実質 `${url.origin}/_cache/${renditionKey(...)}`。ルーティングされることはなく、キーとしてのみ存在する。）
`cache.put` の前に **`Vary` を落とす**（`Vary: Accept-Encoding` にするか削除）。`Vary: User-Agent` が
付いたまま保存するとほぼマッチせず、キャッシュが純粋なオーバーヘッドになる。機械的な注意 2 点:
`cache.put` は body を消費するので `clone()` を渡す、GET Request とキャッシュ可能ステータスが必要。

`caches.default` は Vitest の node 環境に存在しないので、テスト可能にするため注入可能にする:
`deliverImage({ ..., cache = typeof caches !== "undefined" ? caches.default : null })`。

### 6. 段階的ロールアウト用の var

`wrangler.toml` の `[vars]` に `IMG_AUTO_MAX_WIDTH = "0"` を追加（`0` = 縮小無効、フォーマット変換のみ）。
`types/env.d.ts` にも足す。初期デプロイは `0` で出し、1 週間様子を見てから `"1600"` に上げる。
縮小はフォーマット変換より破壊的な変更（素の URL を自前の後段処理のソースにしている利用者はピクセルを失う）
なので、コード変更なしで戻せる形にしておく。

### 7. `images.width` / `height` の記録

`app/features/images/probe.ts`:

```ts
export async function probeImageDimensions(
  env: Env, bytes: ArrayBuffer,
): Promise<{ width: number; height: number } | null>
```

- `env.IMAGES.info()` には **新しいストリーム**（`new Blob([bytes]).stream()`）を渡す。R2 に渡した
  ストリームを使い回してはならない（`ReadableStream` は 1 回限り、共有するとアップロードが壊れる）。
- `"width" in info` なら値を返す。SVG 形状 (`{ format: "image/svg+xml" }`) は `null`。
  throw（`ImagesError` 9412 含む）も `null` + `console.warn`。**絶対に throw せず、アップロードを失敗させない。**
  `contentType === "image/svg+xml"` なら呼び出し自体をスキップ。
- 呼び出し元: `uploadImage`（`createImage` の前。現在ハードコードの `width: null, height: null` を置換）と
  `replaceImageForActor`（同じくハードコードの null。ロールバック時に旧 `width/height` を戻す既存の
  処理は正しいのでそのまま）。
- `setMobileImageForActor` は `mobile_width`/`mobile_height` 列が無いのでスキップ（列追加は今回のスコープ外）。
- 既存行の dims は NULL のまま。`scale-down` が未知幅を吸収し、ビルダーは「元 N px」のヒントを隠すだけ。
  バックフィルはしない。

### 8. ダッシュボードの URL ビルダー UI

`app/routes/i.$id.tsx` は既に 503 行あり、カードを足すと明らかに膨らむ。**同じコミットで**
既存カードを `app/features/images/components/` へ切り出す（`replace-card.tsx`, `mobile-card.tsx`,
`slug-card.tsx`, `folder-card.tsx`, `chapter-card.tsx`）。ルートは loader + 組み立てだけになる。

新規 `app/features/images/components/url-builder-card.tsx`:

- **コントロール**: 幅（`WIDTH_LADDER` + 「auto」の `<Select>`）、高さ（任意）、fit、品質（既定は auto）、
  フォーマット（auto / avif / webp / jpeg / png / original）、dpr（1×/2×/3×）、
  variant（`image.mobile` があるときだけ表示）。非 canonical な選択には
  「プリセットとしてキャッシュされません」という控えめなヒントを出す（§3 の永続化ゲートに対して正直に）。
- **URL 生成はサーバと同じ `deliveryUrl()` を通す。** `img-url.ts` を `app/lib/` に置いたままにするのは
  この共有のため。シリアライザを 1 つにしておけば、ビルダーの表示とルートのパースがずれない。
- **ライブプレビュー**: 既存の枠内で `<img src={builtUrl + "&v=" + image.updatedAt}>`。`onLoad` で
  `naturalWidth`/`naturalHeight` を読み、§7 のソース寸法と並べて表示。
- **絶対 URL + コピー**: `i.$id.tsx` の既存 `onCopy`/`copied` パターンを再利用。
- **before/after のバイト数**: before は loader が既に持つ `image.byteSize`。after は同一オリジンへの
  `fetch(builtUrl).then(r => r.blob()).then(b => b.size)`。専用 API を足さない。
  **トレードオフ**: 画像を 2 回目に取りに行く（通常はブラウザの HTTP キャッシュから返るので実質無料だが
  保証はない）。`performance.getEntriesByName()` の `encodedBodySize` は HTTP キャッシュヒットと 304 で
  `0` を返すためフォールバックが必要な上、その回避策として付けたくなるランダムなキャッシュバスタ
  パラメータは **ここでは有害**（新しいパラメータ = 新しい派生物）。`fetch` + `blob.size` で始める。
- 既存の **Public URL カード**に一行追加: 「この URL は自動で最適化されます（AVIF/WebP、最大 1600px）。
  無加工のファイルは `?f=original` を付けてください。」OpenAPI を読まない人にとってはここが唯一の
  エスケープハッチの発見面。

### 9. モジュール分割

`$id.tsx` は loader + 304 短絡だけの ~110 行に収める。

| ファイル | 責務 |
| --- | --- |
| `app/lib/img-url.ts`（拡張） | `TransformOpts`(+`dpr`, `f:…\|"original"`)、`parseTransformOpts` のクランプ、`deliveryUrl`。ルートと UI の両方が使う |
| `app/lib/img-transform.ts`（新規・純） | ラダー、定数、`negotiateFormat`、`resolveDelivery`、`renditionParamSlug`、`isCanonical` |
| `app/lib/http-cache.ts`（新規・小） | `matchesEtag`（ルートから移動）、`notModified()`、`cacheHeaders()`、`varyHeader()`、Vary を落とす `cachePut` |
| `app/features/images/rendition-key.ts`（新規・純） | `renditionKey`、`renditionCacheUrl`、`deliveryEtag`、`renditionPrefixForImage`、`renditionPrefixForSource` |
| `app/features/images/variant.ts`（新規） | `selectSourceVariant(image, url, headers)` — 現在 loader 内にインラインの ~30 行 + `sourceVersion` |
| `app/features/images/rendition-store.ts`（新規・env） | `getRendition`、`putRendition`、`putPassthroughMarker`、`deleteRenditionsForImage`、`deleteRenditionsForSource`。`storage.ts` は originals 専用のまま |
| `app/features/images/delivery.server.ts`（新規） | `deliverImage(...)`。**読み取り経路で `env.IMAGES` に触る唯一のモジュール** |
| `app/features/images/probe.ts`（新規） | `probeImageDimensions` |

---

## 変更する主なファイル

- `img/wrangler.toml` — `DERIVED` バケット、`IMG_AUTO_MAX_WIDTH` var（→ `cf-typegen`）
- `img/app/routes/$id.tsx` — 全面書き換え（上記フロー）
- `img/app/routes/i.$id.tsx` — カード分割 + URL ビルダー
- `img/app/lib/img-url.ts` — `dpr` / `f=original`
- `img/app/features/images/service.ts` — `probeImageDimensions` 呼び出し、`ctx` の追加、派生物掃除
- `img/app/features/images/{delivery.server,rendition-store,rendition-key,variant,probe}.ts` — 新規
- `img/app/lib/{img-transform,http-cache}.ts` — 新規
- `img/openapi/paths/public-image.yaml` — `dpr` 追加、`f` に `original`、自動最適化の記述、
  `ETag`/`Vary`/`Cache-Control` レスポンスヘッダ
- `img/CLAUDE.md`, `img/README.md`

---

## リスク

**既存の URL でのバイト変化（最大のリスク）。** 全ての既存埋め込みが異なるバイト・多くの場合異なる
Content-Type を返し始める。

- *1600px への縮小*はフォーマット変換より重い破壊。→ `IMG_AUTO_MAX_WIDTH` var で段階投入（§6）、
  初回デプロイ**前**に `?f=original` を CLAUDE.md / README / OpenAPI に記載、告知する。
- *Content-Type の変化* — URL に拡張子が無いのでファイル名ベースのものは壊れない。正直な `Accept` を
  送る側はネゴシエーションで守られ、`Accept: */*` の側は jpeg/png へ正しく落ちる。唯一の地雷は
  現行 `formatFor()` の無条件 jpeg フォールバックによる PNG アルファ破壊で、§3 で同時に直す。
- *偽の 304* — ETag にフォーマットを含める（§5）、テストで固定（下記）。

**R2 ストレージ増加。** canonical 限定で 1 ソースあたり最悪 48 オブジェクト（実際は 3〜6）、
30 日ライフサイクルで上限が付く。導入前後のバケットサイズを記録して見積もりの当否を確認すること。

**匿名の派生物スパム。** `?w=1..4096` の総当たりはラダーで 12 に落ちる。積（幅×高さ×fit×品質×形式）は
原理的にはまだ大きく、だからこそ**主防御はラダーではなく永続化ゲート** — 攻撃者は変換課金を焚けても、
1 ソースあたり永久に 48 回しか R2 書き込みを起こせない。第 3 層がライフサイクル。
残る露出は正直に言うと「非 canonical パラメータを列挙して**課金対象の変換**を焚ける」ことで、
それが現実の問題になったらレート制限か非 canonical の認証必須化で対処する（キー空間の追加調整ではない）。

**Images 課金。** 派生ストアの目的そのもの（リクエストごと → (ソース,パラメータ,形式) ごと 1 回）。
なお再課金が起きる 3 経路: ライフサイクル失効（ホット派生物あたり月 1 回、誤差）、非 canonical
パラメータ（永続化されないのでエッジミスのたび）、アップロード/置換時の `info()`（変更あたり 1 回、
ホットパス外）。Cache API 層は 2 番目を実質的に減らす。

---

## Verification

```bash
pnpm --filter @gdgjp/img test
```

- `app/lib/img-transform.test.ts` — Accept × ソース種別の `negotiateFormat` 行列、
  **特に PNG + `Accept: */*` → `png`（`jpeg` ではない）**。gif は決して avif にならない。
  ラダー切り上げ（`1→160`, `161→320`, `1600→1600`, `9999→4096`）。dpr 畳み込み
  （`w=800&dpr=2 → 1600`、`dpr=3` 単独は無視、`MAX_DPR` クランプ）。
  `f=original`/svg/gif/小サイズ → 正しい `reason` の passthrough。既知寸法での拡大クランプ。
  `isCanonical` の境界。
- `app/features/images/rendition-key.test.ts` — **順序非依存**（`?w=800&q=80` と `?q=80&w=800` が
  バイト一致のキー・キャッシュ URL・ETag を生む）、`d`/`m` が衝突しない、`sourceVersion` 変化でキーが変わる、
  `isValidImageId(key) === false`、ETag とキー形式の文字列完全一致アサーション（形式変更を意図的な行為にする）。
- `app/features/images/delivery.test.ts` — 偽の `ORIGINALS`/`DERIVED`/`IMAGES`/`cache`
  （`repository.test.ts`/`service.test.ts` の D1 偽装と同じスタイル）で:
  派生ヒット時に `IMAGES` を一切呼ばない / ミス時に 1 回だけ変換し R2 に 1 オブジェクトだけ書く /
  **非 canonical は変換するが書き込まない** / `IMAGES` の throw が 500 ではなく 200 + オリジナルになる /
  9412 はマーカーを書き汎用エラーは書かない / 自動パスで肥大したらフォールバック + マーカー。
- `app/lib/img-url.test.ts` — `deliveryUrl` ↔ `parseTransformOpts` の往復（`dpr`, `f=original` 含む）。
- `app/features/images/probe.test.ts` — SVG 形状 → `null`、throw → `null`。

E2E（`img/e2e/`）は現状未認証のみ（`home.spec.ts` が `/signin?return_to=%2F` を固定）。公開画像の
シードが無く、意味のある配信 E2E には認証付きアップロードが必要になるので、`GET /<unknown-id>` → 404 の
安価な否定スペックだけ足し、実質はすべて Vitest で見る。アップロード用フィクスチャをこのために作らない。

手動確認（`pnpm --filter @gdgjp/img dev`、:5175 / accounts :5173）:

```bash
curl -sI -H 'Accept: image/avif,image/webp,*/*' http://localhost:5175/<id>
```

1. AVIF の `Content-Type`、`Vary` に `Accept`、`ETag` に `.avif` が入ることを確認。
2. 同じ URL を 2 回叩き、2 回目が派生物ヒットになる（`wrangler` ログに変換が出ない）ことを確認。
3. `?f=original` がオリジナルのバイト数と Content-Type を返すことを確認。
4. `?w=800&dpr=2` と `?w=1600` が同一 ETag を返すことを確認。
5. SVG と animated GIF をアップロードし、素の URL が無加工で返ることを確認。
6. `/i/<id>` の URL ビルダーで幅を動かし、プレビューと before/after バイト数が更新されることを確認。
7. 置換後に素の URL の ETag が変わり、新しいバイトが返ることを確認。

最後に:

```bash
pnpm ci:quick
```

---

## コミット順序

1. `refactor(img): split i.$id.tsx cards into features/images/components` — 挙動不変
2. `refactor(img): extract variant selection + etag helpers from $id.tsx` — 挙動不変
3. `feat(img): canonical transform resolution + rendition key scheme` — 純関数 + テストのみ、未配線
4. `feat(img): derived rendition store` — `DERIVED` バインディング、`cf-typegen`、`rendition-store.ts`、
   delete/replace/mobile への掃除配線（`ctx` を通す）
5. `feat(img): auto-optimize public delivery` — `delivery.server.ts` + `$id.tsx` 書き換え。
   **`IMG_AUTO_MAX_WIDTH = "0"` で出す**
6. `feat(img): probe source dimensions on upload and replace`
7. `feat(img): URL builder on the image detail page`
8. `docs(img): document auto-optimization` — CLAUDE.md / README / OpenAPI + 再生成
9. ソーク後に `IMG_AUTO_MAX_WIDTH` を `1600` に

## デプロイ時の手作業（コードでは自動化されない）

```bash
wrangler r2 bucket create gdgjp-img-derived
wrangler r2 bucket lifecycle add gdgjp-img-derived --name expire-renditions --expire-days 30
```

PR 説明に新バインディング・バケット作成・ライフサイクルルールを明記する（リポジトリ規約）。
