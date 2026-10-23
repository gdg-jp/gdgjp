# prototype.tsx の書き方

## 目次

1. 仕組み
2. 使えるもの
3. ファイルの組み立て方（例つき）
4. フレームの作り方
5. 操作できる App の作り方（flows、切り替え、複数案、複数の利用者）
6. 見た目のルール
7. モバイルの部品の選び方
8. 確かめ方
9. よくある失敗

## 1. 仕組み

`prototype.tsx` は `definePrototype({...})` を default export します。
ビルドするとビューアが付き、次の 3 つのタブを持つ HTML になります。

| タブ | 表示するもの | 使う値 |
| --- | --- | --- |
| 画面一覧 | `frames` の各フレームを、画面ごとに縮小して並べる（mockup） | `frames[].render()` |
| 操作 | `App` を 1 つ動かす。デスクトップとモバイル、`controls` の切り替え、`flows` のシナリオ一覧がある（prototype） | `App`、`controls`、`flows` |
| 仕様 | `spec.md` | — |

フレームと App は、それぞれ独立した iframe の中で描画されます。
そのため、各フレームは次のように振る舞います。

- 自分専用のビューポートを持つ。メディアクエリ、`AppShell` のモバイル表示、`position: fixed` が実際の画面と同じように効く。
- Dialog や Sheet のポータルは、そのフレームの中に開く。
- ほかのフレームや App と状態を共有しない。

`ThemeProvider` と `Toaster` はビューアが用意します。
ライト／ダークの切り替えもビューアが行います。

## 2. 使えるもの

import できるのは次のモジュールです。
ビルドはデザインシステムの `node_modules` から解決するので、ほかのパッケージは入っていません。

| モジュール | 用途 |
| --- | --- |
| `@gdgjp/design-system` | すべての UI 部品と `toast`。正確な export 名は `scripts/components.mjs` で確かめる |
| `prototype-kit` | `definePrototype`、`useIsMobile`、型（`Frame`、`Flow`、`Control`、`ControlValues`、`Prototype`、`Viewport`） |
| `react` | `useState` など |
| `lucide-react` | アイコン。デザインシステムの story と同じく、`<CalendarDays size={18} aria-hidden="true" />` のように使う |

型チェックが通らないとビルドは止まります。
存在しない prop を書くとここで分かるので、エラー文を読んで直してください。
型だけを import するときは `import type` を使います。

`prototype.tsx` が長くなったら、同じディレクトリに `screens.tsx` や `fixtures.ts` を作って分割して構いません。

## 3. ファイルの組み立て方

上から順に、次の 6 つを置きます。

1. **型と fixture:** 画面に出すデータを、本物らしい日本語で書く。長い名前、0 件、上限ぎりぎりの件数などの境界値も入れる。
2. **画面コンポーネント:** props だけで描画が決まる純粋な関数にする。状態を持たせず、操作は `onXxx?: () => void` で受け取る。
3. **Layout:** `AppShell` などの共通の枠。「今どこにいるか」とナビゲーションのハンドラを props で受け取る。
4. **App:** `useState` で画面の切り替えとデータの変化を持ち、画面コンポーネントに配る。
5. **`definePrototype`:** 状態ごとの props で画面コンポーネントを呼んで、フレームを作る。
6. **`flows`:** spec.md の「画面遷移」の主要フローを、check.mjs が操作できる手順として書く。

画面コンポーネントを純粋にしておくのが要点です。
同じ部品を、フレームでは固定データで、App では生きた状態で描けます。
そのため、mockup と prototype の見た目がずれません。

```tsx
import {
  AppShell,
  Badge,
  Button,
  Card,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  EmptyState,
  FormField,
  Input,
  PageHeader,
  Stack,
  Table,
  toast,
} from "@gdgjp/design-system";
import { Link2, Plus, Settings } from "lucide-react";
import { definePrototype } from "prototype-kit";
import { type ReactNode, useState } from "react";

// 1. 型と fixture
type ShortLink = { slug: string; url: string; clicks: number };
const links: ShortLink[] = [
  { slug: "devfest", url: "https://gdg.community.dev/devfest-tokyo-2026", clicks: 1204 },
  { slug: "io-extended-2026-kansai-hands-on", url: "https://example.com/very/long/path", clicks: 87 },
];

// 3. Layout
type Page = "links" | "settings";
const pages = [
  { id: "links", label: "リンク", icon: Link2 },
  { id: "settings", label: "設定", icon: Settings },
] as const;

function Layout({
  current,
  onNavigate,
  children,
}: {
  current: Page;
  onNavigate?: (page: Page) => void;
  children: ReactNode;
}) {
  return (
    <AppShell
      brand="GDG Links"
      navigation={
        <nav className="gdg-sidebar-nav" aria-label="メイン">
          {pages.map(({ id, label, icon: Icon }) => (
            <a
              key={id}
              href={`#${id}`}
              aria-current={current === id ? "page" : undefined}
              onClick={(event) => {
                event.preventDefault();
                onNavigate?.(id);
              }}
            >
              <Icon size={18} aria-hidden="true" />
              {label}
            </a>
          ))}
        </nav>
      }
    >
      {children}
    </AppShell>
  );
}

// 2. 画面コンポーネント（純粋）
function LinksScreen({ items, onCreate }: { items: ShortLink[]; onCreate?: () => void }) {
  return (
    <Stack>
      <PageHeader
        title="リンク"
        description="短縮リンクを管理します。"
        actions={
          <Button onClick={onCreate}>
            <Plus size={16} aria-hidden="true" />
            リンクを作成
          </Button>
        }
      />
      <Card>
        {items.length === 0 ? (
          <EmptyState title="リンクがありません" description="最初のリンクを作成しましょう。" />
        ) : (
          <Table>
            <caption className="gdg-sr-only">リンク一覧</caption>
            <thead>
              <tr>
                <th scope="col">スラッグ</th>
                <th scope="col">転送先</th>
                <th scope="col">クリック</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.slug}>
                  <td>{item.slug}</td>
                  <td className="text-muted">{item.url}</td>
                  <td>
                    <Badge tone={item.clicks > 1000 ? "success" : "neutral"}>{item.clicks}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </Stack>
  );
}

function CreateDialog({
  open,
  error,
  onOpenChange,
  onSubmit,
}: {
  open: boolean;
  error?: string;
  onOpenChange?: (open: boolean) => void;
  onSubmit?: (slug: string) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogTitle>リンクを作成</DialogTitle>
        <DialogDescription>スラッグと転送先を入力します。</DialogDescription>
        <form
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            onSubmit?.(String(new FormData(event.currentTarget).get("slug") ?? ""));
          }}
        >
          <Stack>
            <FormField label="スラッグ" required error={error}>
              <Input name="slug" />
            </FormField>
            <Button type="submit">作成</Button>
          </Stack>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// 4. App
function App() {
  const [page, setPage] = useState<Page>("links");
  const [items, setItems] = useState(links);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string>();
  return (
    <Layout current={page} onNavigate={setPage}>
      {page === "links" ? (
        <LinksScreen items={items} onCreate={() => setCreating(true)} />
      ) : (
        <PageHeader title="設定" description="この prototype では扱いません。" />
      )}
      <CreateDialog
        open={creating}
        error={error}
        onOpenChange={(open) => {
          setCreating(open);
          setError(undefined);
        }}
        onSubmit={(slug) => {
          if (!slug) return setError("スラッグを入力してください。");
          setItems([{ slug, url: "https://example.com", clicks: 0 }, ...items]);
          setCreating(false);
          toast.success("リンクを作成しました");
        }}
      />
    </Layout>
  );
}

// 5. フレーム
export default definePrototype({
  title: "GDG Links 管理画面",
  summary: "短縮リンクの一覧と作成",
  frames: [
    {
      id: "links",
      screen: "リンク一覧",
      state: "通常",
      render: () => (
        <Layout current="links">
          <LinksScreen items={links} />
        </Layout>
      ),
    },
    {
      id: "links-empty",
      screen: "リンク一覧",
      state: "0 件",
      note: "初回利用時。作成への導線が見えるか",
      render: () => (
        <Layout current="links">
          <LinksScreen items={[]} />
        </Layout>
      ),
    },
    {
      id: "links-mobile",
      screen: "リンク一覧",
      state: "通常",
      viewport: "mobile",
      render: () => (
        <Layout current="links">
          <LinksScreen items={links} />
        </Layout>
      ),
    },
    {
      id: "create-error",
      screen: "リンク作成",
      state: "入力エラー",
      render: () => (
        <Layout current="links">
          <LinksScreen items={links} />
          <CreateDialog open error="スラッグを入力してください。" />
        </Layout>
      ),
    },
  ],
  // 6. 主要フロー（check.mjs が App を操作して確かめる）
  flows: [
    {
      name: "リンクを作成する",
      steps: [
        { click: "リンクを作成" },
        { click: "作成" },
        { expect: "スラッグを入力してください。" },
        { fill: "スラッグ", value: "meetup" },
        { click: "作成" },
        { expect: "リンクを作成しました" },
        { expect: "meetup" },
      ],
    },
  ],
  App,
});
```

## 4. フレームの作り方

- **spec.md の「画面ごとの状態」表と 1 対 1 にする。** `id` は表の frame id、`screen` と `state` は表の値をそのまま使う。ビューアは `screen` でグループにまとめる。
- **各フレームは画面全体を描く。** `Layout` まで含める。フレームは独立した文書なので、枠を省くと実際の画面に見えない。
- **オーバーレイは開いた状態で描く。** `Dialog`、`Sheet`、`Drawer`、`AlertDialog` には `open` を、`DropdownMenu`、`Popover`、`Select` には `open` か `defaultOpen` を渡す。フレームの中で開くので、ほかのフレームには影響しない。
- **`note` には、レビューで見てほしい点を書く。** 例: 「初回利用時。作成への導線が見えるか」。
- **`viewport` は既定で `"desktop"`（1280×800）。** 利用者がスマートフォンを使うなら、主な画面に `"mobile"`（390×844）のフレームも足すか、`definePrototype` の `viewport` を `"mobile"` にする。
- **`height` は、スクロールしないと見えない部分が状態の要点であるときだけ伸ばす。** 画面一覧のフレームは `height` で切れて表示される。全件を見せる必要はなく、伸ばすのはビューポートの 2 倍まで。必要な値は check.mjs の `note:` が教えてくれる。
- **トーストのように数秒で消えるものは、フレームにしない。** 操作タブとフローで確かめる。
- **入力済みの状態を描くときは、`value` と一緒に `onChange` も渡す。** 画面コンポーネントの `onChange` を省略可能にしているなら、既定で何もしない関数を渡す。`value` だけを渡すと React が警告を出す。

## 5. 操作できる App の作り方

### 基本

- **画面の切り替えは `useState` で持つ。** URL、`location.hash`、`history`、`localStorage` は使わない。ビューアがハッシュを使っているのと、iframe の中では URL が意味を持たないため。
- **App で辿れる流れは、spec.md の「画面遷移」と一致させる。** 主要なストーリーは最初から最後まで操作できるようにする。範囲外の画面は「この prototype では扱いません」と表示するだけでよい。
- **データの変化も見せる。** 作成・削除が一覧に反映され、成功は `toast` で知らせ、検証エラーは `FormField` の `error` に出す。
- **フォームには `noValidate` を付ける。** 付けないとブラウザー標準の検証吹き出しが出て送信が止まり、`FormField` のエラー表示まで辿り着かない。
- **読み込み中を見せたいときだけ `setTimeout` で短く待つ（500ms 程度）。** 待ち時間そのものを再現する必要はない。
- **サーバー通信、認証、本物の API は使わない。** fixture を初期値にした `useState` で十分。
- **振る舞いがモバイルで変わるときは `useIsMobile()` を使う。** 見た目だけなら Tailwind の `md:`（768px、デザインシステムのブレークポイントと同じ）で足りる。

### flows: 主要フローを手順として書く

`flows` に書いた手順を、check.mjs が App 上で 1 つずつ実行し、手順ごとにスクリーンショットを撮ります。
押すボタンが見つからない、期待した文言が出ない、といった失敗はエラーとして報告されます。
操作タブの「シナリオ」にも同じ手順が一覧で表示されるので、レビューする人が何を試せばよいか分かります。

| 手順 | 意味 |
| --- | --- |
| `{ click: "保存" }` | その名前のボタン・リンク・タブ・メニュー項目・選択肢・チェックボックスなどを押す。名前はアクセシブルネーム（表示テキストか `aria-label`）。完全一致を先に探し、なければ部分一致で探す。候補が 2 つ以上あると、最初のものを押して警告を出す |
| `{ fill: "スラッグ", value: "meetup" }` | そのラベル（またはプレースホルダー）の入力欄に入力する |
| `{ select: "開催形式", option: "オンライン" }` | そのラベルの `Select` か `NativeSelect` で選ぶ |
| `{ press: "Escape" }` | キーを押す |
| `{ expect: "保存しました" }` | その文言を含む要素が表示されていることを確かめる（部分一致）。「却下」のような短い語はトーストなど別の場所にも当たるので、行やメッセージの文言全体を書く |
| `{ control: "role", value: "owner" }` | 切り替え（下記）を変える |

`Flow` には `viewport` と、切り替えの初期値 `controls` も指定できます。
主要フローごとに 1 つ書き、各フローの最後には結果を確かめる `expect` を置きます。
同じ名前のボタンが画面に 2 つあると意図しないほうを押すことがあるので、そのときはボタンの文言を区別できるものにします。
これは利用者にとっても分かりやすくなります。
行全体を押せるようにした一覧では、行の名前に中のバッジや説明まで入りやすいので、7 章のとおりタイトルだけを名前にします。

### controls: prototype 専用の切り替え

製品の画面には出さないが、レビューのために切り替えたいものは `controls` に定義します。
操作タブのツールバーに表示され、App は `controls` prop で現在の値を受け取ります。
切り替えても App の状態は保たれます。

```tsx
function App({ controls }: { controls: ControlValues }) {
  const [requests, setRequests] = useState(fixtures.requests); // 視点を切り替えても共有される
  if (controls.role === "owner") return <OwnerScreen requests={requests} onApprove={...} />;
  return <StaffScreen requests={requests} onRequest={...} />;
}

export default definePrototype({
  // ...
  controls: [
    {
      id: "role",
      label: "視点",
      options: [
        { value: "requester", label: "申請者" },
        { value: "partner", label: "相手" },
        { value: "owner", label: "オーナー" },
      ],
    },
  ],
  App,
});
```

主な使い道は次の 3 つです。

- **複数の利用者が登場するフロー（申請 → 承認など）:** `視点` の切り替えを作り、データは App の 1 つの `useState` で共有する。flows では `{ control: "role", value: "owner" }` で視点を変えて、相手側の画面に反映されたことを `expect` で確かめる。視点ごとの画面には `key={controls.role}` を付け、開いていたドロワーや入力途中の値が別の視点に持ち越されないようにする。利用者ごとに端末が違うなら、App の既定 `viewport` は主要な利用者の端末に合わせ、ほかの利用者のフレームには個別に `viewport` を付ける。
- **外から来る出来事の再現:** QR の読み取り結果、カメラの許可、通信の失敗のように、利用者の操作ではなく外から起きることは、「次の QR」「通信」のような切り替えで結果を選ばせる。App では、画面コンポーネントに `onSimulateScan?` のような任意のハンドラを渡したときだけ、カメラ枠などを押せるようにする（`aria-label` に「（試作）」を付ける）。フレームではハンドラを渡さないので、製品の見た目のまま描ける。
- **複数案の比較:** `案` の切り替えを作り、案ごとにレイアウトだけを変える。fixture、純粋な画面コンポーネント、App の状態は共有するので、同じデータ・同じ操作で案を見比べられる。フレームは `screen` を「案A 一覧＋プレビュー」のように案の名前から始め、画面一覧で案ごとにまとまるようにする。

## 6. 見た目のルール

デザインシステムの `DESIGN.md` に従います。
特に次の点に注意します。

- **まずデザインシステムのコンポーネントで組む。** 並べるだけなら `Stack`（縦、16px 間隔）と `Inline`（横、12px 間隔）を使い、面を作るなら `Card` を使う。`Card` は入れ子にしない。
- **足りない部分だけを Tailwind のユーティリティで補う。** トークンに対応した名前を使う。
  - 文字色: `text-foreground` `text-muted` `text-link` `text-danger` `text-success` `text-warning`
  - 面: `bg-background`（ページの地、くぼんだ面）、`bg-surface`（カードなど浮いた面）、`bg-selected`（選択中）、`bg-gdg-neutral`（中立の薄い面）
  - 状態の面: Tailwind の名前がないので `bg-[var(--gdg-success-surface)]` のように書く（`--gdg-warning-surface`、`--gdg-danger-surface` も同様）。ダークテーマでは面との差が小さいので、強調に使うなら太字などを併用する
  - 黒と白: カメラのプレビューなど、テーマによらず暗い面が要るときだけ `bg-black` `text-white`
  - 枠線: `border-border`
  - 間隔: 4px 単位（`gap-2` = 8px、`gap-4` = 16px、`p-6` = 24px）
  - 角丸: `rounded-sm` `rounded-md` `rounded-lg`
  - レイアウト: `grid` `grid-cols-*` `flex` `md:` などのブレークポイント
- **`bg-secondary` と `text-secondary` は薄い色ではない。** secondary ボタンの濃い青緑（#5D899D）なので、薄い面には `bg-gdg-neutral` か `bg-background` を使う。`ToggleGroup` の選択中の地、`Item variant="muted"`、`Progress` の地もこの色になる。重く見えるときは `className` で `bg-gdg-neutral` に上書きし、spec.md の「デザインシステムにないもの」に書く。
- **使わないもの:** 16 進数の色、`style={{ color: ... }}`、独自の CSS ファイル、グラデーション、装飾的な枠線。
- **primary ボタンは、見えている層ごとに 1 つ。** ダイアログやドロワーが開いているときは、その中で 1 つと数える（背後の画面は操作できないため）。補助的な操作は `secondary`、`outline`、`ghost` にし、削除の確定にだけ `danger` を使う。check.mjs は見えている primary が 2 つ以上あると警告する。
- **見出しの階層を大きさで崩さない。** `Card` の中の `Heading level={2}` はページの見出しに近い大きさになるので、カード内の小見出しは `className="text-lg"` などで一段小さくする。フォームの途中の「候補が 0 件」のような小さな空状態には、`EmptyState`（h2 を持つ）ではなく `Alert` か `Text tone="muted"` を使う。`Empty` は自分の破線の枠を持つので、`Card` には入れない。
- **ダイアログの中身が長くなるときは、ボタンの行をスクロール領域の外に置く。** 本文だけを `<div className="max-h-[60dvh] overflow-auto">` に入れ、その後ろにボタンの行を置く。ボタンが一緒にスクロールして画面外に出ると、check.mjs が警告する。
- **文言は本番に出せる日本語で書く。** ダミー文（lorem ipsum、「テキストテキスト」）は使わない。ボタンは「保存」「リンクを作成」のように動詞で書く。見出しは 1 行に収まる長さにし、可変の名前は説明文に回す。
- **アクセシビリティ:** `Dialog`、`Sheet`、`Drawer` には Title と Description を付ける。`IconButton` には `aria-label` を、`Table` には `caption` を付ける（見せないなら `gdg-sr-only`）。入力欄には `FormField` でラベルを付ける。

## 7. モバイルの部品の選び方

| したいこと | 部品 |
| --- | --- |
| 項目の詳細を見せて、その場で 1 つ操作させる（本人確認してチェックインなど） | `Drawer`（下から出る）。Title と Description を付け、操作ボタンは `DrawerFooter` に置く。`DrawerFooter` は既定で右寄せの横並びなので、スマートフォンでは `className="grid grid-cols-2 gap-3"` にし、ボタンに `size="lg" fullWidth` を付けて親指で押しやすくする |
| 絞り込みやナビゲーションを横から出す | `Sheet` |
| 取り消せない操作の確認 | `AlertDialog` |
| PC での集中した入力 | `Dialog`。モバイルでは画面いっぱいの入力画面か `Drawer` を検討する |
| タップできる行の一覧 | `ItemGroup` と `Item`。行全体を押せるようにするには、`Item` に `relative` を付け、`ItemTitle` の中に `<button type="button" className="text-left after:absolute after:inset-0">` を置く（押せる範囲が行全体に広がり、ボタンの名前はタイトルだけになる）。`Item` は既定で横並び・上下中央揃えなので、複数行の内容なら `items-start` を付ける |
| 画面下部に固定する主操作 | 画面コンポーネントの最下部に `sticky bottom-0 bg-surface` の領域を作る。ドロワーの中では、中身だけをスクロールさせ、ボタンは常に見えるようにする |

ほかに、既定のレイアウトで気をつける部品があります。

- `AppShell` の `header` は右寄せ。左右に分けて置くなら、左側を `flex-1` の入れ物で包む。
- `TabsList` は狭い幅で折り返す。タブの文言は短くする（折り返すと check.mjs が警告する）。
- `RadioGroup` は 16px 間隔の縦並び、`FieldSet` は枠と余白を持つ。

部品の既定の見た目は story だけでは分からないことが多いので、`components.mjs` が示す `source:` のファイルと `src/styles/components.css` も確かめる。

`components.mjs` で「Other」に分類される `Inline`、`Heading`、`Text`、`Label`、`Link`、`Toggle`、`ToggleGroup` などは、DESIGN.md の分類に名前が出てこないだけの基本部品です。
自由に使って構いません。

## 8. 確かめ方

`check.mjs` の出力は、1 行ごとに次の意味を持ちます。

| 記号 | 意味 | 対応 |
| --- | --- | --- |
| `✓` | 問題なし | — |
| `!` + `warning:` | コンソールの警告、横へのはみ出し、primary ボタンが複数、短い見出しやタブの折り返し、ダイアログのボタンが画面外、flows のクリックの候補が複数 | 原則として直す。意図どおりなら spec.md に理由を書く |
| `✗` + `error:` | 描画中の例外、コンソールのエラー、フローの失敗 | 必ず直す |
| `note:` | フレームの下に少しだけ内容が続いている（下端のボタンなどが切れている可能性）、flows がない、など | 判断材料。必要なら `height` を伸ばす、flows を書く。一覧が長く続くだけなら無視してよい |

各行の末尾の秒数は、その項目にかかった時間です。
全体は通常 1 分以内に終わります。
手順のあいだで何分も止まり CPU も使っていないなら、たいていマシンのスリープによる一時停止で、スクリプトの問題ではありません。
長引きそうなときはバックグラウンドで実行し、出力を `tail` や `grep` に通さずにそのまま読みます（1 行ずつ出るので、どこまで進んだかが分かる）。

スクリーンショットは `shots/` に保存されます。

- `<frame id>.png`: フレームを画面一覧と同じ大きさで撮ったもの
- `flow-<n>-<step>.png`: フローの手順ごとの画面
- `flow-<n>-<step>-failed.png`: 失敗した手順の画面
- `app.desktop.png`、`app.mobile.png`: App の最初の画面
- `_board.png`: 画面一覧

手で確かめたいときは、ブラウザーで `<dir>/.build/check/check.html` を開きます。
URL の末尾に `#solo=<frame id>&theme=dark` を付けるとそのフレームだけを、`#view=play` を付けると操作タブを開けます。

## 9. よくある失敗

| 症状 | 原因と対処 |
| --- | --- |
| 型エラー `Property 'x' does not exist` | prop 名の推測ミス。`scripts/components.mjs` が示す story ファイルを読み、実際の使い方を確かめる |
| `Unknown icon` という警告 | `Icons` の `name` がカタログにない。lucide-react から直接 import する |
| フレームが真っ白、または赤いエラー表示 | 描画中の例外。`check.mjs` の出力に出たスタックを読む |
| `Rendered fewer hooks than expected` | `useState` より前で `return` している。フックは条件分岐より前にまとめる |
| Dialog に `DialogTitle` がないという警告 | Radix の要件。視覚的に要らなくても Title と Description を置く |
| フローの `click` が「見つかりません」 | ボタンの文言が違うか、まだ表示されていない。エラーに出る「表示中:」の一覧と `flow-*-failed.png` を見る |
| 送信してもエラー表示が出ず、「このフィールドを入力してください」の吹き出しが出る | `<form>` に `noValidate` がない |
| ダイアログを閉じる途中で、文言の一部が空になる | 閉じると同時に対象データを `null` にしている。開閉の state と対象データを分け、データは閉じた後も残す |
| オーバーレイを開いたフレームで、先頭のボタンにフォーカスリングが写る | Radix の初期フォーカス。確認ダイアログ（キャンセルに初期フォーカス）はそのままでよい。情報を読ませる Drawer は `onOpenAutoFocus={(event) => event.preventDefault()}` で初期フォーカスを外す |
| `FormField` の中に自作した選択肢カードの説明文まで太字になる | `.gdg-field label` の太字が効いている。説明文に `font-normal` を付ける |
| フレームのナビゲーションが選択状態にならない | `Layout` に `current` を渡し忘れている |
| モバイルのフレームで横スクロールが出る | 固定幅（`w-[800px]` など）を使っている。`Table` は自分の中でスクロールするので、外側に幅を指定しない |
| 縦に長いデスクトップのフレームで、サイドバーの背景が途中で切れて写る | サイドバーは `100dvh` の高さで描かれるため。撮影上の見え方で、実際の画面では起きない。気になるなら `height` を伸ばしすぎない |
