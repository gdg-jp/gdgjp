# GDG Apps UI library

GDG Apps の正式なWebデザインシステム。React 19、Radix Primitives、CSSトークンを基盤とし、Light／Dark、アクセシビリティ、控えめなアニメーションを共通化します。ルーター・認証・データ取得から独立したprivate workspaceです。

## 開発

リポジトリルートで `pnpm install` 後、以下を実行します。

| コマンド | 内容 |
| --- | --- |
| `pnpm --filter @gdgjp/gdg-ui-library dev` | Storybook、port 6006 |
| `pnpm --filter @gdgjp/gdg-ui-library build` | ESM、型宣言、CSS、フォントをdistへ出力 |
| `pnpm --filter @gdgjp/gdg-ui-library typecheck` | 実装・Storybookの型検査 |
| `pnpm --filter @gdgjp/gdg-ui-library test` | 公開API・SSR・色のコントラスト |
| `pnpm --filter @gdgjp/gdg-ui-library test:consumer` | ビルド済み公開exportのみでSSR・型解決・ブラウザービルド |
| `pnpm --filter @gdgjp/gdg-ui-library test:e2e` | Storybook／consumerをビルドしてPlaywright・axe・画像比較 |

ブラウザーの初回準備は `pnpm --filter @gdgjp/gdg-ui-library exec playwright install chromium`。生成物はコミットしません。画像比較の基準画像はテスト資産として管理します。

## 利用

利用アプリのdependenciesに `"@gdgjp/gdg-ui-library": "workspace:*"` を登録します。今回は既存アプリへの登録・換装は実施していません。

```tsx
import { ThemeProvider, Button, FormField, Input } from "@gdgjp/gdg-ui-library";
import "@gdgjp/gdg-ui-library/tokens.css";
import "@gdgjp/gdg-ui-library/components.css";
import "@gdgjp/gdg-ui-library/fonts.css";

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
@import "@gdgjp/gdg-ui-library/tailwind.css";
@import "@gdgjp/gdg-ui-library/components.css";
@import "@gdgjp/gdg-ui-library/fonts.css";
```

`tailwind.css` はトークンと `@theme inline` の対応表です。Tailwind本体やPreflightは含みません。上の例では利用側が `tailwindcss` のimportによってPreflightを選択しています。リセット不要ならTailwindのtheme.cssとutilities.cssだけを読み込んでください。

コンポーネント自身は通常のCSSクラスを使い、Tailwindのソース探索を必要としません。利用側は `bg-background text-foreground bg-primary text-primary-foreground bg-gdg-red` 等を使えます。色は `--gdg-*` を正本とし、意味トークンを参照します。レイヤー順を最初に宣言することで、利用側utilitiesが部品CSSを上書きできます。

### テーマとSSR

`ThemeProvider` は文書単位で一つ配置します。既定は `system`、保存キーは `gdg-apps-theme`。`useTheme()` はnext-themesの `theme / resolvedTheme / setTheme` を返します。`ThemeToggle` はシステム・ライト・ダークの選択を提供します。

SSRでは `<html lang="ja" suppressHydrationWarning>` を使用してください。next-themesの初期化スクリプトが最初の描画前にhtmlのclassを設定します。CSP使用時はリクエストごとのnonceを `ThemeProvider nonce={nonce}` に渡します。Provider外の先行したテーマ依存UIを避け、テーマ値によってDOMを変える部分はマウント完了まで安定した内容を出力してください。

Portalはdocument.bodyへ配置し、htmlのテーマを継承します。部分ツリーごとの別テーマは提供しません。`forcedTheme` はカタログ等の固定表示専用です。全体のテーマ変更に遷移アニメーションはありません。

## 公開部品と契約

| 分類 | Exportと用途 |
| --- | --- |
| 操作 | `Button`, `IconButton`, `Link`。Buttonはprimary／secondary／outline／ghost／danger、sm／md／lg。既定typeはbutton。IconButtonのaria-labelは必須 |
| 表示 | `Text`（xs／sm／md、default／muted）、`Heading`（level 1〜6）、`Stack`, `Inline`, `Card`, `Separator`, `Badge`（neutral／info／success／warning／danger）、`Avatar`（src、alt、fallback） |
| フォーム | `FormField`, `Input`, `Textarea`, `Checkbox`, `RadioGroup`＋`RadioGroupItem`, `Switch`, `Select`＋`SelectTrigger`, `SelectValue`, `SelectContent`, `SelectItem`, `SelectGroup`, `SelectLabel` |
| オーバーレイ | `Dialog`, `AlertDialog`, `Sheet`, `Popover`, `DropdownMenu`, `Tooltip` と対応するTrigger／Content、必要なTitle／Description／Close／Action／Cancel／Item。TooltipProviderも公開 |
| 状態 | `Alert`（tone、title、children）、`Toaster`, `toast`, `Spinner`, `Skeleton`, `EmptyState`（title、description、action） |
| 構造 | `Table`, `Pagination`（page、pageCount、onPageChange）、`Tabs`＋List／Trigger／Content、`Accordion`＋Item／Trigger／Content、`Breadcrumb`, `Toolbar`, `PageHeader`, `AppShell`, `SidebarNav` |
| テーマ | `ThemeProvider`, `ThemeToggle`, `useTheme` |
| 補助 | `cn`。clsx＋tailwind-mergeによるclassName合成 |

Radix部品はRadixのcontrolled／uncontrolled props、イベント、refを維持します。DOM部品はネイティブ属性とrefを受け取ります。コンポーネント内部のDOM構造に依存したセレクタは公開契約ではありません。

### 状態とアクセシビリティ

- Buttonのloadingはaria-busyと二重実行防止、通常ボタンではSpinnerを伴います。disabledはネイティブdisabled、asChildではaria-disabled・tab順序・クリック抑止に対応します。asChildは属性とイベント、refを転送する一つの要素を渡してください。リンク合成時のloading内容は呼び出し側で用意します。
- FormFieldは一つの入力を包みます。label／説明／エラーをidで結び、required／disabled／invalidを渡します。明示idはFormFieldに指定します。`name`、検証ロジック、送信処理は利用側が所有します。
- Input／Textareaのreadonlyは選択・コピー可能なまま、disabledは操作不可。フォーム送信への影響はHTML標準に従います。Radix Selectのrequired／disabledはRootへも伝播します。
- RadioGroupにはFormFieldまたはaria-label／aria-labelledbyでグループ名を付け、各RadioGroupItemにもlabelを付けます。複数の別入力を一つのFormFieldに入れません。
- Dialog／SheetにはTitleとDescription、AlertDialogにはTitle・Description・Cancel・Actionを配置します。内容・Escape・Tab・フォーカス復帰はRadixの契約に従います。Triggerなしのcontrolled表示では `onCloseAutoFocus` で復帰先を明示します。
- Tableはcaption、thead／tbody、thのscopeを利用側で指定します。横幅が足りない場合は表の領域内でスクロールし、`scrollLabel` で領域名を変更できます。
- Breadcrumbはliをchildrenに渡し、末尾にaria-current="page"。SidebarNavはリンクをchildrenに渡し、選択中リンクにaria-current="page"。URL判定はライブラリに持ち込みません。
- Toolbarは配置部品です。矢印キー操作を提供しないためARIA toolbarロールは付けません。
- Skeletonは静止した装飾プレースホルダー。読込状態はSpinnerのlabelか親のaria-busyとメッセージで通知します。情報・成功・警告・危険は色とラベル／アイコンで表します。

詳細な判断基準・変更手順は [DESIGN.md](DESIGN.md)、組み合わせ例と状態一覧はStorybookを参照してください。
