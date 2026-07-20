import { GdgAccountMenu, GdgAppLauncher } from "@gdgjp/gdg-lib/ui";
import { ChartPie, Globe, ListTodo, Moon, PanelLeft, PanelLeftClose, Sun } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Form, Link, useFetcher, useLocation, useSearchParams } from "react-router";
import NotificationBell from "./NotificationBell";

interface NavbarProps {
  user: { name: string; email: string; image?: string | null } | null;
  sidebarOpen?: boolean;
  onToggleSidebar?: () => void;
  unreadNotificationCount?: number;
}

function UiLangSwitcher() {
  const { t, i18n } = useTranslation();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const langFetcher = useFetcher();

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  function selectLang(lang: "ja" | "en") {
    i18n.changeLanguage(lang);
    localStorage.setItem("ui_lang", lang);
    langFetcher.submit({ lang }, { method: "post", action: "/api/set-ui-lang" });
    setOpen(false);
  }

  const current = i18n.language === "en" ? "en" : "ja";

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title={t("language.switch_ui")}
        className="flex items-center gap-1 rounded-md p-1.5 text-gray-500 hover:bg-gray-100 hover:text-gray-700"
        aria-label={t("language.switch_ui")}
      >
        <Globe size={18} aria-hidden="true" />
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-1 min-w-[7rem] rounded-md border border-gray-200 bg-white py-1 shadow-lg">
          {(["ja", "en"] as const).map((lang) => (
            <button
              key={lang}
              type="button"
              onClick={() => selectLang(lang)}
              className={[
                "block w-full px-3 py-1.5 text-left text-sm",
                current === lang ? "font-semibold text-blue-600" : "text-gray-700 hover:bg-gray-50",
              ].join(" ")}
            >
              {t(`language.${lang}`)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function UserMenu({ user }: { user: NonNullable<NavbarProps["user"]> }) {
  const { t } = useTranslation();
  return (
    <GdgAccountMenu
      accountUrl="https://accounts.gdgs.jp/dashboard"
      onSignOut={() => window.location.assign("/logout")}
      settings={{ href: "/settings", label: t("settings.title") }}
      signOutLabel={t("auth.sign_out")}
      user={user}
    />
  );
}

function ThemeSwitcher() {
  const { t } = useTranslation();
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    setIsDark(document.documentElement.classList.contains("dark"));
  }, []);

  function toggleTheme() {
    const nextIsDark = !isDark;
    setIsDark(nextIsDark);
    document.documentElement.classList.toggle("dark", nextIsDark);
    localStorage.setItem("theme", nextIsDark ? "dark" : "light");
    document.cookie = `theme=${nextIsDark ? "dark" : "light"}; path=/; max-age=31536000; SameSite=Lax`;
  }

  const title = isDark ? t("theme.switch_to_light") : t("theme.switch_to_dark");

  return (
    <button
      type="button"
      onClick={toggleTheme}
      title={title}
      aria-label={title}
      className="flex items-center justify-center rounded-md p-1.5 text-gray-500 hover:bg-gray-100 hover:text-gray-700"
    >
      {isDark ? <Sun size={18} aria-hidden="true" /> : <Moon size={18} aria-hidden="true" />}
    </button>
  );
}

function NewPageDropdown() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  return (
    <div ref={ref} className="relative hidden sm:block">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="whitespace-nowrap rounded-md bg-blue-500 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-blue-600"
      >
        + {t("nav.new_page")}
      </button>
      {open && (
        <div className="absolute right-0 top-full z-50 mt-1 w-44 overflow-hidden rounded-md border border-gray-200 bg-white shadow-md">
          <Link
            to="/ingest"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
          >
            <span>✦</span>
            <span>{t("pageTree.newPage_ai")}</span>
          </Link>
          <Link
            to="/analyze"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
          >
            <ChartPie size={14} />
            <span>{t("pageTree.newPage_analyze")}</span>
          </Link>
          <Link
            to="/wiki/new"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
          >
            <span>✎</span>
            <span>{t("pageTree.newPage_manual")}</span>
          </Link>
          <Link
            to="/tasks/new"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
          >
            <ListTodo size={14} />
            <span>{t("pageTree.newTaskList")}</span>
          </Link>
        </div>
      )}
    </div>
  );
}

export default function Navbar({
  user,
  sidebarOpen,
  onToggleSidebar,
  unreadNotificationCount,
}: NavbarProps) {
  const { t } = useTranslation();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const currentQuery = searchParams.get("q") ?? "";
  const [queryInput, setQueryInput] = useState(currentQuery);

  // Sync input value when the URL q param changes (e.g. back/forward nav)
  useEffect(() => {
    setQueryInput(currentQuery);
  }, [currentQuery]);

  return (
    <header className="fixed top-0 right-0 left-0 z-50 flex h-14 items-center gap-2 border-b border-gray-200 bg-white px-3 sm:gap-4 sm:px-4">
      {/* Sidebar toggle */}
      {onToggleSidebar && (
        <button
          type="button"
          onClick={onToggleSidebar}
          title={sidebarOpen ? t("nav.close_sidebar") : t("nav.open_sidebar")}
          aria-label={sidebarOpen ? t("nav.close_sidebar") : t("nav.open_sidebar")}
          className="flex items-center justify-center rounded-md p-1.5 text-gray-500 hover:bg-gray-100 hover:text-gray-700"
        >
          {sidebarOpen ? <PanelLeftClose size={20} /> : <PanelLeft size={20} />}
        </button>
      )}

      {/* Logo */}
      <Link to="/" className="flex flex-shrink-0 items-center gap-2">
        <img
          src="/app-icon.png"
          alt="GDG Japan Wiki"
          width={1254}
          height={1254}
          className="size-8 object-contain"
        />
        <span className="hidden text-sm font-semibold tracking-tight sm:block">GDG Japan Wiki</span>
      </Link>

      {/* Search */}
      <Form action="/search" method="get" className="flex flex-1 justify-center">
        <input
          name="q"
          type="search"
          value={queryInput}
          onChange={(e) => setQueryInput(e.target.value)}
          placeholder={`${t("nav.search")}…`}
          className="w-full max-w-[400px] rounded-md border border-gray-200 bg-gray-50 px-3 py-1.5 text-sm text-gray-900 placeholder:text-gray-400 focus:border-blue-500 focus:bg-white dark:focus:bg-gray-100 focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
      </Form>

      {/* Right actions */}
      <div className="flex flex-shrink-0 items-center gap-3">
        {user && <NewPageDropdown />}

        {user && <NotificationBell initialCount={unreadNotificationCount ?? 0} />}

        <ThemeSwitcher />

        <UiLangSwitcher />

        {user ? (
          <>
            <GdgAppLauncher />
            <UserMenu user={user} />
          </>
        ) : (
          <Link
            to={`/signin?return_to=${encodeURIComponent(`${location.pathname}${location.search}`)}`}
            className="text-sm font-medium text-blue-500 hover:underline"
          >
            {t("auth.sign_in")}
          </Link>
        )}
      </div>
    </header>
  );
}
