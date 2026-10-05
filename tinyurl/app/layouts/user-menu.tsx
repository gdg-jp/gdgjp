import {
  Avatar,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  IconButton,
  Icons,
} from "@gdgjp/design-system";
import { GDG_APP_LINKS } from "@gdgjp/gdg-lib/ui/app-links";
export type UserMenuUser = { email: string; image: string | null; name: string };
export function UserMenu({
  user,
}: { launcherPosition?: "left" | "right"; user: UserMenuUser | null }) {
  if (!user) return null;
  return (
    <div className="flex items-center gap-1">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <IconButton variant="ghost" aria-label="GDG アプリ">
            <Icons name="LayoutGrid" aria-hidden="true" size={20} />
          </IconButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuLabel>GDG アプリ</DropdownMenuLabel>
          {GDG_APP_LINKS.map((app) => (
            <DropdownMenuItem key={app.url} asChild>
              <a href={app.url}>
                <img src={app.iconUrl} width={20} height={20} alt="" />
                {app.label}
              </a>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <IconButton variant="ghost" aria-label="アカウントメニュー">
            <Avatar src={user.image ?? undefined} alt="" fallback={user.name.slice(0, 1)} />
          </IconButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuLabel>
            <div>{user.name}</div>
            <div className="text-xs text-muted">{user.email}</div>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild>
            <a href="https://accounts.gdgs.jp/dashboard">アカウント設定</a>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <a href="/auth/signout">ログアウト</a>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
