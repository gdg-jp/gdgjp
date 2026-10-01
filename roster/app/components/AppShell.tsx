import { GdgAccountMenu, GdgAppLauncher } from "@gdgjp/gdg-lib/ui";
import {
  CalendarDays,
  CalendarRange,
  ChevronDown,
  LayoutDashboard,
  Plus,
  Share2,
  UserRound,
  UsersRound,
} from "lucide-react";
import type { ReactNode } from "react";
import { Link, NavLink, useLocation, useNavigate, useParams } from "react-router";
import { type EventStatus, STATUS_LABELS } from "~/features/events/status";
import { RosterBrand } from "./RosterBrand";

type ShellEvent = {
  id: string;
  chapterId: number;
  name: string;
  date: string;
  status: EventStatus;
};

type ShellChapter = { id: number; slug: string };

const EVENT_NAV = [
  ["design", "設計", CalendarRange],
  ["staff", "スタッフ", UsersRound],
  ["roster", "シフト表", CalendarDays],
  ["share", "共有", Share2],
] as const;

export function AppShell({
  children,
  user,
  chapters,
  events,
  accountsUrl,
}: {
  children: ReactNode;
  user: { name: string; email: string; image: string | null };
  chapters: ShellChapter[];
  events: ShellEvent[];
  accountsUrl: string;
}) {
  const { id } = useParams();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const currentEvent = events.find((event) => event.id === id) ?? null;
  const chapterName = (chapterId: number) =>
    chapters.find((chapter) => chapter.id === chapterId)?.slug ?? `Chapter ${chapterId}`;

  return (
    <div className="app-shell">
      <aside className="app-sidebar">
        <div className="sidebar-header">
          <Link to="/" className="brand-link" aria-label="Roster イベント一覧">
            <RosterBrand />
          </Link>
          <div className="sidebar-launcher">
            <GdgAppLauncher ariaLabel="アプリ一覧" />
          </div>
        </div>

        <div className="sidebar-context">
          <div className="event-switcher">
            <label htmlFor="event-switcher">イベント</label>
            <select
              id="event-switcher"
              value={currentEvent?.id ?? ""}
              onChange={(event) => {
                const eventId = event.currentTarget.value;
                void navigate(eventId ? `/e/${eventId}` : "/");
              }}
            >
              <option value="">イベント一覧</option>
              {events.map((event) => (
                <option key={event.id} value={event.id}>
                  {event.name} · {chapterName(event.chapterId)} · {event.date} ·{" "}
                  {STATUS_LABELS[event.status]}
                </option>
              ))}
            </select>
          </div>
          <p className="chapter-context">
            {currentEvent
              ? chapterName(currentEvent.chapterId)
              : chapters.length === 1
                ? chapterName(chapters[0].id)
                : `${chapters.length} Chapters`}
          </p>
        </div>

        <nav className="sidebar-nav" aria-label="管理画面">
          <NavLink to="/" end className={navClassName}>
            <LayoutDashboard aria-hidden="true" />
            <span>イベント一覧</span>
          </NavLink>
          {currentEvent ? (
            <div className="event-nav-group">
              <p className="nav-label">このイベント</p>
              <NavLink to={`/e/${currentEvent.id}`} end className={navClassName}>
                <LayoutDashboard aria-hidden="true" />
                <span>概要</span>
              </NavLink>
              {EVENT_NAV.map(([segment, label, Icon]) => (
                <NavLink
                  key={segment}
                  to={`/e/${currentEvent.id}/${segment}`}
                  className={navClassName}
                >
                  <Icon aria-hidden="true" />
                  <span>{label}</span>
                </NavLink>
              ))}
            </div>
          ) : null}
          <Link
            to="/events/new"
            aria-current={pathname === "/events/new" ? "page" : undefined}
            className={
              pathname === "/events/new"
                ? "sidebar-link sidebar-create-link active"
                : "sidebar-link sidebar-create-link"
            }
          >
            <Plus aria-hidden="true" />
            <span>イベントを作成</span>
          </Link>
        </nav>

        <div className="sidebar-account">
          <GdgAccountMenu
            accountUrl={`${accountsUrl}/dashboard`}
            onSignOut={() => window.location.assign("/auth/signout")}
            signOutLabel="ログアウト"
            trigger={
              <button type="button" className="account-trigger" aria-label="アカウントメニュー">
                <span className="account-avatar">
                  {user.image ? <img src={user.image} alt="" /> : <UserRound aria-hidden="true" />}
                </span>
                <span className="account-copy">
                  <span className="account-name">{user.name || user.email}</span>
                  <span className="account-label">アカウント</span>
                </span>
                <ChevronDown className="account-chevron" aria-hidden="true" />
              </button>
            }
            user={user}
          />
        </div>
      </aside>
      <div className="app-content">{children}</div>
    </div>
  );
}

function navClassName({ isActive }: { isActive: boolean }) {
  return isActive ? "sidebar-link active" : "sidebar-link";
}
