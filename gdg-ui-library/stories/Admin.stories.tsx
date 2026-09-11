import type { Meta, StoryObj } from "@storybook/react-vite";
import { CalendarDays, Link2, MoreHorizontal, Plus, Search, Settings, Users } from "lucide-react";
import { useState } from "react";
import * as UI from "../src";
export function AdminDemo() {
  const [query, setQuery] = useState("");
  const [edit, setEdit] = useState(false);
  const [name, setName] = useState("コミュニティミートアップ");
  const [deleted, setDeleted] = useState(false);
  const navigation = (
    <UI.SidebarNav aria-label="メイン">
      <a href="#events" aria-current="page">
        <CalendarDays size={18} />
        イベント
      </a>
      <a href="#links">
        <Link2 size={18} />
        リンク
      </a>
      <a href="#members">
        <Users size={18} />
        メンバー
      </a>
      <a href="#settings">
        <Settings size={18} />
        設定
      </a>
    </UI.SidebarNav>
  );
  return (
    <UI.AppShell
      brand="GDG Apps"
      navigation={navigation}
      header={
        <>
          <UI.Text size="sm" tone="muted">
            デザインシステム / サンプル
          </UI.Text>
          <UI.ThemeToggle />
          <UI.Avatar alt="サンプルユーザー" fallback="GD" />
        </>
      }
    >
      <UI.Stack>
        <UI.PageHeader
          title="イベント"
          description="コミュニティの次の一歩を、ここから。"
          actions={
            <UI.Button onClick={() => setEdit(true)}>
              <Plus size={16} />
              イベントを作成
            </UI.Button>
          }
        />
        <div className="gdg-stat-grid">
          {[
            ["開催予定", "3", "次回は9月26日"],
            ["参加登録", "128", "コミュニティ全体"],
            ["公開中のリンク", "24", "最新の情報を共有"],
          ].map(([label, value, description]) => (
            <UI.Card key={label}>
              <UI.Text tone="muted" size="sm">
                {label}
              </UI.Text>
              <p className="gdg-stat-value">{value}</p>
              <UI.Text size="sm" tone="muted">
                {description}
              </UI.Text>
            </UI.Card>
          ))}
        </div>
        <UI.Card>
          <UI.Stack>
            <UI.Toolbar>
              <UI.Heading level={2}>イベント一覧</UI.Heading>
              <UI.Inline>
                <Search size={18} aria-hidden="true" />
                <UI.Input
                  aria-label="イベントを検索"
                  placeholder="イベントを検索"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </UI.Inline>
            </UI.Toolbar>
            {deleted || (query && !name.includes(query)) ? (
              <UI.EmptyState
                title="イベントがありません"
                description="条件を変えるか、新しいイベントを作成してください。"
              />
            ) : (
              <UI.Table>
                <caption className="gdg-sr-only">開催予定のイベント</caption>
                <thead>
                  <tr>
                    <th scope="col">イベント名</th>
                    <th scope="col">開催日</th>
                    <th scope="col">状態</th>
                    <th scope="col">操作</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>
                      <UI.Link href="#event">{name}</UI.Link>
                      <UI.Text size="xs" tone="muted">
                        開発者同士で学び、つながる一日
                      </UI.Text>
                    </td>
                    <td>2026/09/26</td>
                    <td>
                      <UI.Badge tone="success">公開中</UI.Badge>
                    </td>
                    <td>
                      <UI.DropdownMenu>
                        <UI.DropdownMenuTrigger asChild>
                          <UI.IconButton aria-label="イベント操作" variant="ghost">
                            <MoreHorizontal size={18} />
                          </UI.IconButton>
                        </UI.DropdownMenuTrigger>
                        <UI.DropdownMenuContent>
                          <UI.DropdownMenuItem onSelect={() => setEdit(true)}>
                            編集
                          </UI.DropdownMenuItem>
                          <UI.DropdownMenuItem onSelect={() => UI.toast("リンクをコピーしました")}>
                            リンクをコピー
                          </UI.DropdownMenuItem>
                        </UI.DropdownMenuContent>
                      </UI.DropdownMenu>
                    </td>
                  </tr>
                </tbody>
              </UI.Table>
            )}
            <UI.Toolbar>
              <UI.Text size="sm" tone="muted">
                {deleted ? 0 : 1} 件のイベント
              </UI.Text>
              <UI.Pagination page={1} pageCount={1} onPageChange={() => {}} />
            </UI.Toolbar>
          </UI.Stack>
        </UI.Card>
        <UI.Alert tone="info" title="これはサンプル画面です">
          架空のデータを使用しています。操作はこの画面内だけに反映されます。
        </UI.Alert>
        <UI.AlertDialog>
          <UI.AlertDialogTrigger asChild>
            <UI.Button variant="ghost">イベントを削除</UI.Button>
          </UI.AlertDialogTrigger>
          <UI.AlertDialogContent>
            <UI.AlertDialogTitle>イベントを削除しますか？</UI.AlertDialogTitle>
            <UI.AlertDialogDescription>
              このサンプル一覧からイベントを取り除きます。
            </UI.AlertDialogDescription>
            <UI.Inline>
              <UI.AlertDialogCancel asChild>
                <UI.Button variant="outline">キャンセル</UI.Button>
              </UI.AlertDialogCancel>
              <UI.AlertDialogAction asChild>
                <UI.Button
                  variant="danger"
                  onClick={() => {
                    setDeleted(true);
                    UI.toast.success("削除しました");
                  }}
                >
                  削除する
                </UI.Button>
              </UI.AlertDialogAction>
            </UI.Inline>
          </UI.AlertDialogContent>
        </UI.AlertDialog>
      </UI.Stack>
      <UI.Dialog open={edit} onOpenChange={setEdit}>
        <UI.DialogContent>
          <UI.DialogTitle>イベントを編集</UI.DialogTitle>
          <UI.DialogDescription>参加者に伝わる名前を設定してください。</UI.DialogDescription>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setEdit(false);
              setDeleted(false);
              UI.toast.success("保存しました");
            }}
          >
            <UI.Stack>
              <UI.FormField label="イベント名" required>
                <UI.Input value={name} onChange={(e) => setName(e.target.value)} />
              </UI.FormField>
              <UI.FormField label="説明" description="参加者に表示する短い説明です。">
                <UI.Textarea defaultValue="開発者同士で学び、つながる一日" />
              </UI.FormField>
              <UI.Inline>
                <UI.Button type="submit">保存</UI.Button>
                <UI.DialogClose asChild>
                  <UI.Button variant="outline">キャンセル</UI.Button>
                </UI.DialogClose>
              </UI.Inline>
            </UI.Stack>
          </form>
        </UI.DialogContent>
      </UI.Dialog>
      <UI.Toaster />
    </UI.AppShell>
  );
}
const meta = { title: "Patterns/Admin", component: AdminDemo } satisfies Meta<typeof AdminDemo>;
export default meta;
export const Default: StoryObj<typeof meta> = {};
