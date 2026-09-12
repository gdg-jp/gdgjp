# GDG Apps UI library

GDG Apps の正式なWebデザインシステム。React 19、Radix Primitives、CSSトークンを基盤とし、claymorphismの柔らかな立体感、Light／Dark、アクセシビリティ、控えめなアニメーションを共通化します。ルーター・認証・データ取得から独立したprivate workspaceです。

角丸は `--gdg-radius-*` の半径値と `--gdg-corner-shape: squircle` を一つの契約として扱います。`components.css` は `gdg-*` 要素とその子孫を同じ半径スコープに置くため、有限半径を追加するときは `border-radius` だけを追加すればSquircleになります。円・pill・角丸なしの形状は明示的に維持し、`corner-shape` 未対応ブラウザーでは `border-radius` の標準形状へフォールバックします。

## 開発

リポジトリルートで `pnpm install` 後、以下を実行します。

| コマンド | 内容 |
| --- | --- |
| `pnpm --filter @gdgjp/ui dev` | Storybook、port 6006 |
| `pnpm --filter @gdgjp/ui build` | ESM、型宣言、CSS、フォントをdistへ出力 |
| `pnpm --filter @gdgjp/ui typecheck` | 実装・Storybookの型検査 |
| `pnpm --filter @gdgjp/ui test` | 公開API・SSR・色のコントラスト |
| `pnpm --filter @gdgjp/ui test:consumer` | ビルド済み公開exportのみでSSR・型解決・ブラウザービルド |
| `pnpm --filter @gdgjp/ui test:e2e` | Storybook／consumerをビルドしてPlaywright・axe・画像比較 |

ブラウザーの初回準備は `pnpm --filter @gdgjp/ui exec playwright install chromium`。生成物はコミットしません。画像比較の基準画像はテスト資産として管理します。

## 利用

利用アプリのdependenciesに `"@gdgjp/ui": "workspace:*"` を登録します。今回は既存アプリへの登録・換装は実施していません。

```tsx
import { ThemeProvider, Button, FormField, Input } from "@gdgjp/ui";
import "@gdgjp/ui/tokens.css";
import "@gdgjp/ui/components.css";
import "@gdgjp/ui/fonts.css";

export function App() {
  return (
    <ThemeProvider>
      <main className="gdg-preview">
        <FormField label="表示名" description="参加者に表示される名前です。" required>
          <Input name="displayName" />
        </FormField>
        <Button type="submit">保存</Button>
      </main>
    </ThemeProvider>
  );
}
```

`fonts.css` は任意の独立した読み込みです。同梱するGoogle SansとNoto Sans JPはOFL配布物です。フォントの出典・ライセンスは [assets/FONTS.md](assets/FONTS.md) を参照してください。

### Tailwind v4

```css
@layer theme, base, gdg-tokens, gdg-base, gdg-components, utilities;
@import "tailwindcss";
@import "@gdgjp/ui/tailwind.css";
@import "@gdgjp/ui/components.css";
@import "@gdgjp/ui/fonts.css";
```

`tailwind.css` はトークンと `@theme inline` の対応表です。Tailwind本体やPreflightは含みません。上の例では利用側が `tailwindcss` のimportによってPreflightを選択しています。リセット不要ならTailwindのtheme.cssとutilities.cssだけを読み込んでください。

コンポーネント自身は通常のCSSクラスを使い、Tailwindのソース探索を必要としません。利用側は `bg-background text-foreground bg-primary text-primary-foreground bg-secondary text-secondary-foreground bg-gdg-red` 等を使えます。色は `--gdg-*` を正本とし、意味トークンを参照します。`secondary` は緑寄りの低彩度ブルー（#5D899D）に白い前景色を合わせ、hover は #6B9AAE です。primaryの鮮やかな青と役割を分け、補助操作であることが分かるトーンにしています。hover は利用側で `--gdg-secondary-hover` を上書きして変更でき、従来の中立面には `bg-gdg-neutral` を使います。レイヤー順を最初に宣言することで、利用側utilitiesが部品CSSを上書きできます。

### テーマとSSR

`ThemeProvider` は文書単位で一つ配置します。既定は `system`、保存キーは `gdg-apps-theme`。`useTheme()` はnext-themesの `theme / resolvedTheme / setTheme` を返します。`ThemeToggle` はシステム・ライト・ダークの選択を提供します。

SSRでは `<html lang="ja" suppressHydrationWarning>` を使用してください。next-themesの初期化スクリプトが最初の描画前にhtmlのclassを設定します。CSP使用時はリクエストごとのnonceを `ThemeProvider nonce={nonce}` に渡します。Provider外の先行したテーマ依存UIを避け、テーマ値によってDOMを変える部分はマウント完了まで安定した内容を出力してください。

Portalはdocument.bodyへ配置し、htmlのテーマを継承します。部分ツリーごとの別テーマは提供しません。`forcedTheme` はカタログ等の固定表示専用です。全体のテーマ変更に遷移アニメーションはありません。

## 公開部品と契約

| 分類 | Exportと用途 |
| --- | --- |
| 操作 | `Button`, `IconButton`, `Link`, `ButtonGroup`, `Collapsible`, `Slider`, `Toggle`, `ToggleGroup`。Buttonはprimary／secondary／outline／ghost／danger、sm／md／lg。既定typeはbutton。IconButtonのaria-labelは必須 |
| 表示 | `Text`（xs／sm／md、default／muted）、`Heading`（level 1〜6）、`Stack`, `Inline`, `Card`, `Separator`, `Badge`（neutral／info／success／warning／danger）、`Avatar`, `Attachment`, `Bubble`, `Chart`, `Empty`, `Item`, `Kbd`, `Marker`, `Message`, `Typography` |
| フォーム | `FormField`, `Field`, `Input`, `InputGroup`, `InputOTP`, `Textarea`, `Checkbox`, `RadioGroup`＋`RadioGroupItem`, `Switch`, `Select`, `NativeSelect`, `Calendar`, `DatePicker`, `Combobox`, `Command`, `Questionnaire`, `QuestionnaireNew` |
| オーバーレイ | `Dialog`, `AlertDialog`, `Sheet`, `Drawer`, `Popover`, `DropdownMenu`, `ContextMenu`, `HoverCard`, `Menubar`, `Tooltip` と対応するTrigger／Content、必要なTitle／Description／Close／Action／Cancel／Item。TooltipProviderも公開 |
| 状態 | `Alert`（tone、title、children）、`Progress`, `Toast`, `Toaster`, `toast`, `Spinner`, `Skeleton`, `EmptyState`（title、description、action） |
| 構造 | `AspectRatio`, `Table`, `DataTable`, `Pagination`, `Tabs`＋List／Trigger／Content、`Accordion`＋Item／Trigger／Content、`Breadcrumb`, `NavigationMenu`, `Resizable`, `ScrollArea`, `Sidebar`, `Toolbar`, `PageHeader`, `AppShell`, `SidebarNav`, `Direction` |
| テーマ | `ThemeProvider`, `ThemeToggle`, `useTheme` |
| 補助 | `cn`。clsx＋tailwind-mergeによるclassName合成 |

Radix部品はRadixのcontrolled／uncontrolled props、イベント、refを維持します。DOM部品はネイティブ属性とrefを受け取ります。コンポーネント内部のDOM構造に依存したセレクタは公開契約ではありません。

### 状態とアクセシビリティ

- Buttonのloadingはaria-busyと二重実行防止、通常ボタンではSpinnerを伴います。disabledはネイティブdisabled、asChildではaria-disabled・tab順序・クリック抑止に対応します。asChildは属性とイベント、refを転送する一つの要素を渡してください。リンク合成時のloading内容は呼び出し側で用意します。
- FormFieldは一つの入力を包みます。label／説明／エラーをidで結び、required／disabled／invalidを渡します。明示idはFormFieldに指定します。`name`、検証ロジック、送信処理は利用側が所有します。
- Input／Textareaのreadonlyは選択・コピー可能なまま、disabledは操作不可。フォーム送信への影響はHTML標準に従います。Radix Selectのrequired／disabledはRootへも伝播します。
- DatePickerのテキスト入力は数字を順に受け付け、クリック時に入力全体を選択します。年／月の区切りは自動挿入され、`/` は入力せずに `YYYY/MM/DD` へ整形されます。
- RadioGroupにはFormFieldまたはaria-label／aria-labelledbyでグループ名を付け、各RadioGroupItemにもlabelを付けます。複数の別入力を一つのFormFieldに入れません。
- Dialog／SheetにはTitleとDescription、AlertDialogにはTitle・Description・Cancel・Actionを配置します。内容・Escape・Tab・フォーカス復帰はRadixの契約に従います。Triggerなしのcontrolled表示では `onCloseAutoFocus` で復帰先を明示します。
- Tableはcaption、thead／tbody、thのscopeを利用側で指定します。横幅が足りない場合は表の領域内でスクロールし、`scrollLabel` で領域名を変更できます。
- DataTableは見出しと全セルの表示内容から列ごとの最大幅を求め、比率で既定の列幅を配分します。
- Breadcrumbはliをchildrenに渡し、末尾にaria-current="page"。SidebarNavはリンクをchildrenに渡し、選択中リンクにaria-current="page"。URL判定はライブラリに持ち込みません。
- Sidebarは既定で`collapsible="icon"`です。SidebarHeader内のSidebarTriggerはタイトル右側の正方形アイコンボタンになり、閉じた状態ではメニュー項目のアイコンを残します。完全に収納する場合は`collapsible="offcanvas"`を指定します。
- Toolbarは配置部品です。矢印キー操作を提供しないためARIA toolbarロールは付けません。
- Skeletonは控えめなshimmerが走る装飾プレースホルダーです。読込状態はSpinnerのlabelか親のaria-busyとメッセージで通知し、reduced motionではshimmerを停止します。情報・成功・警告・危険は色とラベル／アイコンで表します。

詳細な判断基準・変更手順は [DESIGN.md](DESIGN.md)、組み合わせ例と状態一覧はStorybookを参照してください。
