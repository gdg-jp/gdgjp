import type { Meta, StoryObj } from "@storybook/react-vite";
import * as UI from "../src";
function Catalog() {
  return (
    <div className="gdg-catalog">
      <UI.PageHeader
        title="GDG Apps"
        description="明瞭で、親しみやすく、一貫したインターフェース。"
      />
      <UI.Card>
        <UI.Stack>
          <UI.Heading>操作</UI.Heading>
          {(["primary", "secondary", "outline", "ghost", "danger"] as const).map((variant) => (
            <UI.Inline key={variant}>
              <UI.Button variant={variant}>{variant}</UI.Button>
              <UI.Button variant={variant} disabled>
                無効
              </UI.Button>
              <UI.Button variant={variant} loading>
                保存中
              </UI.Button>
            </UI.Inline>
          ))}
          <UI.Inline>
            <UI.Button size="sm">小</UI.Button>
            <UI.Button>標準</UI.Button>
            <UI.Button size="lg">大</UI.Button>
            <UI.Button asChild>
              <a href="#link">リンクボタン</a>
            </UI.Button>
          </UI.Inline>
        </UI.Stack>
      </UI.Card>
      <UI.Card>
        <UI.Stack>
          <UI.Heading>フォーム</UI.Heading>
          <UI.FormField label="表示名" description="コミュニティで使う名前です。" required>
            <UI.Input placeholder="例：GDG Japan" />
          </UI.FormField>
          <UI.FormField label="メールアドレス" error="メールアドレスの形式を確認してください。">
            <UI.Input type="email" defaultValue="invalid" />
          </UI.FormField>
          <UI.FormField label="読み取り専用">
            <UI.Input readOnly value="変更できない内容" />
          </UI.FormField>
          <UI.FormField label="無効な入力" disabled>
            <UI.Input value="利用できません" readOnly />
          </UI.FormField>
          <UI.FormField label="説明">
            <UI.Textarea />
          </UI.FormField>
          <UI.FormField label="公開設定">
            <UI.Select defaultValue="draft">
              <UI.SelectTrigger>
                <UI.SelectValue />
              </UI.SelectTrigger>
              <UI.SelectContent>
                <UI.SelectItem value="draft">下書き</UI.SelectItem>
                <UI.SelectItem value="public">公開</UI.SelectItem>
              </UI.SelectContent>
            </UI.Select>
          </UI.FormField>
          <UI.Inline>
            <UI.Checkbox id="agree" />
            <label htmlFor="agree">参加規約に同意する</label>
            <UI.Switch id="notify" />
            <label htmlFor="notify">通知を受け取る</label>
          </UI.Inline>
          <UI.RadioGroup aria-label="参加方法" defaultValue="venue">
            <UI.Inline>
              <UI.RadioGroupItem value="venue" id="venue" />
              <label htmlFor="venue">会場</label>
              <UI.RadioGroupItem value="online" id="online" />
              <label htmlFor="online">オンライン</label>
            </UI.Inline>
          </UI.RadioGroup>
        </UI.Stack>
      </UI.Card>
      <UI.Card>
        <UI.Stack>
          <UI.Heading>オーバーレイ</UI.Heading>
          <UI.Inline>
            <UI.Dialog>
              <UI.DialogTrigger asChild>
                <UI.Button>Dialog</UI.Button>
              </UI.DialogTrigger>
              <UI.DialogContent>
                <UI.DialogTitle>確認と編集</UI.DialogTitle>
                <UI.DialogDescription>Escで閉じ、起点へ戻ります。</UI.DialogDescription>
                <UI.Input aria-label="ダイアログ内の入力" />
              </UI.DialogContent>
            </UI.Dialog>
            <UI.Popover>
              <UI.PopoverTrigger asChild>
                <UI.Button variant="outline">Popover</UI.Button>
              </UI.PopoverTrigger>
              <UI.PopoverContent aria-label="補足情報">
                <UI.Text>起点に紐づいた補足情報です。</UI.Text>
                <UI.PopoverClose asChild>
                  <UI.Button variant="ghost">閉じる</UI.Button>
                </UI.PopoverClose>
              </UI.PopoverContent>
            </UI.Popover>
            <UI.Tooltip>
              <UI.TooltipTrigger asChild>
                <UI.Button variant="outline">Tooltip</UI.Button>
              </UI.TooltipTrigger>
              <UI.TooltipContent>操作の補足説明</UI.TooltipContent>
            </UI.Tooltip>
            <UI.DropdownMenu>
              <UI.DropdownMenuTrigger asChild>
                <UI.Button variant="outline">Menu</UI.Button>
              </UI.DropdownMenuTrigger>
              <UI.DropdownMenuContent>
                <UI.DropdownMenuItem>編集</UI.DropdownMenuItem>
                <UI.DropdownMenuItem disabled>利用不可</UI.DropdownMenuItem>
              </UI.DropdownMenuContent>
            </UI.DropdownMenu>
            <UI.Sheet>
              <UI.SheetTrigger asChild>
                <UI.Button variant="outline">Sheet</UI.Button>
              </UI.SheetTrigger>
              <UI.SheetContent>
                <UI.SheetTitle>ナビゲーション</UI.SheetTitle>
                <UI.SheetDescription>画面端から表示する補助パネル。</UI.SheetDescription>
              </UI.SheetContent>
            </UI.Sheet>
            <UI.Button variant="secondary" onClick={() => UI.toast.success("保存しました")}>
              Toast
            </UI.Button>
          </UI.Inline>
        </UI.Stack>
      </UI.Card>
      <UI.Card>
        <UI.Stack>
          <UI.Heading>状態と構造</UI.Heading>
          {(["info", "success", "warning", "danger"] as const).map((tone) => (
            <UI.Alert key={tone} tone={tone} title={`${tone} の状態`}>
              次の操作が分かるメッセージを表示します。
            </UI.Alert>
          ))}
          <UI.Inline>
            <UI.Avatar alt="サンプル" fallback="GD" />
            <UI.Badge>下書き</UI.Badge>
            <UI.Badge tone="success">公開中</UI.Badge>
            <UI.Spinner />
            <UI.Skeleton style={{ width: 120 }} />
          </UI.Inline>
          <UI.Separator />
          <UI.Tabs defaultValue="overview">
            <UI.TabsList aria-label="表示内容">
              <UI.TabsTrigger value="overview">概要</UI.TabsTrigger>
              <UI.TabsTrigger value="details">詳細</UI.TabsTrigger>
            </UI.TabsList>
            <UI.TabsContent value="overview">概要の内容</UI.TabsContent>
            <UI.TabsContent value="details">詳細の内容</UI.TabsContent>
          </UI.Tabs>
          <UI.Accordion type="single" collapsible>
            <UI.AccordionItem value="one">
              <UI.AccordionTrigger>参加方法を教えてください</UI.AccordionTrigger>
              <UI.AccordionContent>イベントページから登録できます。</UI.AccordionContent>
            </UI.AccordionItem>
          </UI.Accordion>
          <UI.Breadcrumb>
            <li>
              <UI.Link href="#home">ホーム</UI.Link>
            </li>
            <li aria-current="page">イベント</li>
          </UI.Breadcrumb>
          <UI.EmptyState
            title="まだ項目がありません"
            description="最初の項目を追加しましょう。"
            action={<UI.Button>追加</UI.Button>}
          />
        </UI.Stack>
      </UI.Card>
      <UI.Toaster />
    </div>
  );
}
const meta = { title: "Components/Catalog", component: Catalog } satisfies Meta<typeof Catalog>;
export default meta;
export const All: StoryObj<typeof meta> = {};
export function Foundations() {
  return (
    <div className="gdg-catalog">
      <UI.Heading level={1}>Foundations</UI.Heading>
      <UI.Text>ブランド色は固定し、用途ごとの意味トークンをテーマで切り替えます。</UI.Text>
      <div className="gdg-swatch-grid">
        {["blue", "red", "green", "yellow", "white", "white-2", "black", "black-2"].map((color) => (
          <UI.Card key={color}>
            <div className="gdg-swatch" style={{ background: `var(--gdg-${color})` }} />
            <UI.Text>{color}</UI.Text>
          </UI.Card>
        ))}
      </div>
      <UI.Card>
        <UI.Stack>
          <UI.Heading level={1}>コミュニティの次の一歩を</UI.Heading>
          <UI.Heading>学び、つながり、共有する</UI.Heading>
          <UI.Heading level={3}>Google Developer Groups</UI.Heading>
          <UI.Text>本文 16px / Google Sans + Noto Sans JP</UI.Text>
          <UI.Text size="sm">操作 14px / 明確で簡潔なラベル</UI.Text>
          <UI.Text size="xs">補助 12px / 状態と時刻</UI.Text>
        </UI.Stack>
      </UI.Card>
      <UI.Text>余白: 4px単位 / 角丸: 6・8・10・12px / 操作: 40px、タッチ44px</UI.Text>
    </div>
  );
}
