import type { Meta, StoryObj } from "@storybook/react-vite";
import { CalendarDays, Link2, MoreHorizontal, Plus, Search, Settings, Users } from "lucide-react";
import { useEffect, useState } from "react";
import * as UI from "../index.ts";

const pages = [
  { id: "events", label: "イベント", icon: CalendarDays },
  { id: "links", label: "リンク", icon: Link2 },
  { id: "members", label: "メンバー", icon: Users },
  { id: "settings", label: "設定", icon: Settings },
] as const;
type Page = (typeof pages)[number]["id"];

function pageFromHash(hash: string): Page {
  const id = hash.slice(1);
  return pages.some((page) => page.id === id) ? (id as Page) : "events";
}

function OtherPage({ page }: { page: Exclude<Page, "events"> }) {
  if (page === "links")
    return (
      <UI.Stack id="links">
        <UI.PageHeader title="リンク" description="コミュニティで共有するリンクを管理します。" />
        <UI.Card>
          <UI.Stack>
            <UI.Heading level={2}>公開中のリンク</UI.Heading>
            <UI.Link href="https://gdg.community.dev/">GDG Community</UI.Link>
            <UI.Text size="sm" tone="muted">
              イベントやコミュニティの最新情報へ案内します。
            </UI.Text>
          </UI.Stack>
        </UI.Card>
      </UI.Stack>
    );
  if (page === "members")
    return (
      <UI.Stack id="members">
        <UI.PageHeader title="メンバー" description="運営メンバーと権限を確認します。" />
        <UI.Card>
          <UI.Stack>
            <UI.Heading level={2}>運営チーム</UI.Heading>
            <UI.Inline>
              <UI.Avatar alt="サンプルユーザー" fallback="GD" />
              <div>
                <UI.Text>サンプルユーザー</UI.Text>
                <UI.Text size="sm" tone="muted">
                  オーガナイザー
                </UI.Text>
              </div>
            </UI.Inline>
          </UI.Stack>
        </UI.Card>
      </UI.Stack>
    );
  return (
    <UI.Stack id="settings">
      <UI.PageHeader title="設定" description="コミュニティの基本情報を編集します。" />
      <UI.Card>
        <UI.Stack>
          <UI.FormField label="コミュニティ名">
            <UI.Input defaultValue="GDG Apps" />
          </UI.FormField>
          <UI.FormField label="説明">
            <UI.Textarea defaultValue="開発者同士で学び、つながるコミュニティです。" />
          </UI.FormField>
          <UI.Button>変更を保存</UI.Button>
        </UI.Stack>
      </UI.Card>
    </UI.Stack>
  );
}

export function AdminDemo() {
  const [page, setPage] = useState<Page>("events");
  const [query, setQuery] = useState("");
  const [edit, setEdit] = useState(false);
  const [name, setName] = useState("コミュニティミートアップ");
  const [deleted, setDeleted] = useState(false);
  useEffect(() => {
    const syncPage = () => setPage(pageFromHash(window.location.hash));
    syncPage();
    window.addEventListener("hashchange", syncPage);
    return () => window.removeEventListener("hashchange", syncPage);
  }, []);
  const navigation = (
    <UI.SidebarNav aria-label="メイン">
      {pages.map(({ id, label, icon: Icon }) => (
        <a key={id} href={`#${id}`} aria-current={page === id ? "page" : undefined}>
          <Icon size={18} />
          {label}
        </a>
      ))}
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
      {page === "events" ? (
        <UI.Stack id="events">
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
                            <UI.DropdownMenuItem
                              onSelect={() => UI.toast("リンクをコピーしました")}
                            >
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
      ) : (
        <OtherPage page={page} />
      )}
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
