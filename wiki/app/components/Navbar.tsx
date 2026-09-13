import { GdgAccountMenu, GdgAppLauncher } from "@gdgjp/gdg-lib/ui";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
  IconButton,
  Input,
  useTheme,
} from "@gdgjp/ui";

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Form, Link, useFetcher, useLocation, useSearchParams } from "react-router";
import NotificationBell from "~/features/notifications/components/NotificationBell";

import { Icons } from "@gdgjp/ui";
interface NavbarProps {
  user: { name: string; email: string; image?: string | null } | null;
  sidebarOpen?: boolean;
  onToggleSidebar?: () => void;
  unreadNotificationCount?: number;
  onImportZip?: () => void;
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
        <IconButton
          variant="ghost"
          title={t("language.switch_ui")}
          aria-label={t("language.switch_ui")}
          className="text-muted"
        >
          <Icons name="Globe" size={18} aria-hidden="true" />
        </IconButton>
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
  const { theme, resolvedTheme, setTheme } = useTheme();
  const title = t("theme.label");
  const iconName = resolvedTheme === "dark" ? "Moon" : "Sun";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton variant="ghost" title={title} aria-label={title} className="text-muted">
          <Icons name={iconName} size={18} aria-hidden="true" />
        </IconButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuRadioGroup
          value={theme}
          onValueChange={(value) => {
            if (value === "system" || value === "light" || value === "dark") setTheme(value);
          }}
        >
          <DropdownMenuRadioItem value="system">{t("theme.system")}</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="light">{t("theme.light")}</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="dark">{t("theme.dark")}</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function NewPageDropdown({ onImportZip }: { onImportZip?: () => void }) {
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
            <Icons name="ChartPie" size={14} />
            <span>{t("pageTree.newPage_analyze")}</span>
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link to="/wiki/new">
            <span>✎</span>
            <span>{t("pageTree.newPage_manual")}</span>
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onImportZip}>
          <span>⇪</span>
          <span>{t("pageTree.importZip")}</span>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link to="/tasks/new">
            <Icons name="ListTodo" size={14} />
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
  onImportZip,
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
    <header className="fixed top-0 right-0 left-0 z-50 flex h-14 items-center gap-2 border-b border-border bg-surface px-3 sm:gap-4 sm:px-4">
      {/* Sidebar toggle */}
      {onToggleSidebar && (
        <IconButton
          variant="ghost"
          onClick={onToggleSidebar}
          title={sidebarOpen ? t("nav.close_sidebar") : t("nav.open_sidebar")}
          aria-label={sidebarOpen ? t("nav.close_sidebar") : t("nav.open_sidebar")}
          className="text-muted"
        >
          {sidebarOpen ? (
            <Icons name="PanelLeftClose" size={20} />
          ) : (
            <Icons name="PanelLeft" size={20} />
          )}
        </IconButton>
      )}

      {/* Logo */}
      <Link to="/" prefetch="intent" className="flex flex-shrink-0 items-center gap-2">
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
      <Form action="/search" method="get" className="flex min-w-0 flex-1 justify-center">
        <label htmlFor="wiki-search" className="gdg-sr-only">
          {t("nav.search")}
        </label>
        <Input
          id="wiki-search"
          name="q"
          type="search"
          value={queryInput}
          onChange={(e) => setQueryInput(e.target.value)}
          placeholder={`${t("nav.search")}…`}
          className="w-full max-w-[400px]"
        />
      </Form>

      {/* Right actions */}
      <div className="flex shrink-0 items-center gap-1 sm:gap-3">
        {user && <NewPageDropdown onImportZip={onImportZip} />}

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
            className="text-sm font-medium text-link hover:underline"
          >
            {t("auth.sign_in")}
          </Link>
        )}
      </div>
    </header>
  );
}
