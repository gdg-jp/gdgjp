import { GdgAccountMenu, GdgAppLauncher } from "@gdgjp/gdg-lib/ui";
import { ChartPie, Globe, ListTodo, Moon, PanelLeft, PanelLeftClose, Sun } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Form, Link, useFetcher, useLocation, useSearchParams } from "react-router";
import { Button } from "~/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import NotificationBell from "./NotificationBell";

interface NavbarProps {
  user: { name: string; email: string; image?: string | null } | null;
  sidebarOpen?: boolean;
  onToggleSidebar?: () => void;
  unreadNotificationCount?: number;
}

function UiLangSwitcher() {
  const { t, i18n } = useTranslation();
  const langFetcher = useFetcher();

  function selectLang(lang: "ja" | "en") {
    i18n.changeLanguage(lang);
    localStorage.setItem("ui_lang", lang);
    langFetcher.submit({ lang }, { method: "post", action: "/api/set-ui-lang" });
  }

  const current = i18n.language === "en" ? "en" : "ja";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          title={t("language.switch_ui")}
          aria-label={t("language.switch_ui")}
          className="text-muted-foreground"
        >
          <Globe size={18} aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-28">
        <DropdownMenuRadioGroup
          value={current}
          onValueChange={(value) => selectLang(value as "ja" | "en")}
        >
          {(["ja", "en"] as const).map((lang) => (
            <DropdownMenuRadioItem key={lang} value={lang}>
              {t(`language.${lang}`)}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
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
    <Button
      variant="ghost"
      size="icon"
      onClick={toggleTheme}
      title={title}
      aria-label={title}
      className="relative text-muted-foreground"
    >
      <Sun
        size={18}
        aria-hidden="true"
        className={`absolute transition-[opacity,scale,filter] duration-200 ease-[var(--motion-ease-out)] motion-reduce:scale-100 motion-reduce:blur-0 motion-reduce:duration-100 ${isDark ? "scale-100 opacity-100 blur-0" : "scale-25 opacity-0 blur-[4px]"}`}
      />
      <Moon
        size={18}
        aria-hidden="true"
        className={`transition-[opacity,scale,filter] duration-200 ease-[var(--motion-ease-out)] motion-reduce:scale-100 motion-reduce:blur-0 motion-reduce:duration-100 ${isDark ? "scale-25 opacity-0 blur-[4px]" : "scale-100 opacity-100 blur-0"}`}
      />
    </Button>
  );
}

function NewPageDropdown() {
  const { t } = useTranslation();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm" className="hidden whitespace-nowrap sm:inline-flex">
          + {t("nav.new_page")}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuItem asChild>
          <Link to="/ingest">
            <span>✦</span>
            <span>{t("pageTree.newPage_ai")}</span>
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link to="/analyze">
            <ChartPie size={14} />
            <span>{t("pageTree.newPage_analyze")}</span>
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link to="/wiki/new">
            <span>✎</span>
            <span>{t("pageTree.newPage_manual")}</span>
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link to="/tasks/new">
            <ListTodo size={14} />
            <span>{t("pageTree.newTaskList")}</span>
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
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
        <Button
          variant="ghost"
          size="icon"
          onClick={onToggleSidebar}
          title={sidebarOpen ? t("nav.close_sidebar") : t("nav.open_sidebar")}
          aria-label={sidebarOpen ? t("nav.close_sidebar") : t("nav.open_sidebar")}
          className="text-muted-foreground"
        >
          {sidebarOpen ? <PanelLeftClose size={20} /> : <PanelLeft size={20} />}
        </Button>
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
