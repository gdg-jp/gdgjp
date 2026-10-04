import { Icons } from "@gdgjp/design-system";
import { GdgAccountMenu, GdgAppLauncher } from "@gdgjp/gdg-lib/ui";
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
  ["design", "設計", "CalendarDays"],
  ["staff", "スタッフ", "UsersRound"],
  ["roster", "シフト表", "CalendarDays"],
  ["share", "共有", "Share2"],
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
  const { id, sheetId } = useParams();
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
                void navigate(eventId ? `/e/${encodeURIComponent(eventId)}` : "/");
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
            <Icons name="LayoutGrid" aria-hidden="true" animateOnHover={false} />
            <span>イベント一覧</span>
          </NavLink>
          {currentEvent ? (
            <div className="event-nav-group">
              <p className="nav-label">このイベント</p>
              <NavLink to={eventPath(currentEvent.id)} end className={navClassName}>
                <Icons name="LayoutGrid" aria-hidden="true" animateOnHover={false} />
                <span>概要</span>
              </NavLink>
              {EVENT_NAV.map(([segment, label, iconName]) => (
                <NavLink
                  key={segment}
                  to={eventSectionPath(currentEvent.id, segment, sheetId)}
                  className={navClassName}
                >
                  <Icons name={iconName} aria-hidden="true" animateOnHover={false} />
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
            <Icons name="Plus" aria-hidden="true" animateOnHover={false} />
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
                  {user.image ? (
                    <img src={user.image} alt="" />
                  ) : (
                    <Icons name="UserRound" aria-hidden="true" animateOnHover={false} />
                  )}
                </span>
                <span className="account-copy">
                  <span className="account-name">{user.name || user.email}</span>
                  <span className="account-label">アカウント</span>
                </span>
                <Icons
                  name="ChevronDown"
                  className="account-chevron"
                  aria-hidden="true"
                  animateOnHover={false}
                />
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

function eventPath(eventId: string) {
  return `/e/${encodeURIComponent(eventId)}`;
}

function eventSectionPath(
  eventId: string,
  segment: (typeof EVENT_NAV)[number][0],
  sheetId: string | undefined,
) {
  const sheetSegment =
    sheetId && (segment === "design" || segment === "roster")
      ? `/s/${encodeURIComponent(sheetId)}`
      : "";
  return `${eventPath(eventId)}${sheetSegment}/${segment}`;
}
