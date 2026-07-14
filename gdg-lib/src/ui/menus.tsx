import { Grid3X3, LogOut, Settings } from "lucide-react";
import { DropdownMenu as DropdownMenuPrimitive } from "radix-ui";
import type { ReactNode } from "react";
import { preload } from "react-dom";

export type GdgAppLink = {
  iconUrl: string;
  label: string;
  url: string;
};

/** The public apps shown in the shared GDG Japan app launcher. */
export const GDG_APP_LINKS: readonly GdgAppLink[] = [
  {
    iconUrl: "https://url.gdgs.jp/app-icon.png",
    label: "TinyURL",
    url: "https://url.gdgs.jp",
  },
  {
    iconUrl: "https://wiki.gdgs.jp/app-icon.png",
    label: "Wiki",
    url: "https://wiki.gdgs.jp",
  },
  {
    iconUrl: "https://scheduler.gdgs.jp/app-icon.png",
    label: "Scheduler",
    url: "https://scheduler.gdgs.jp",
  },
  {
    iconUrl: "https://img.gdgs.jp/app-icon.png",
    label: "Images",
    url: "https://img.gdgs.jp",
  },
];

const menuTriggerClassName =
  "inline-flex size-8 shrink-0 items-center justify-center rounded-md text-sm font-medium outline-none transition-all hover:bg-accent hover:text-accent-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50";
const menuContentClassName =
  "z-50 max-h-(--radix-dropdown-menu-content-available-height) min-w-[8rem] origin-(--radix-dropdown-menu-content-transform-origin) overflow-x-hidden overflow-y-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-md data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95";

export function GdgAppLauncher({
  apps = GDG_APP_LINKS,
  ariaLabel = "Open app launcher",
}: {
  apps?: readonly GdgAppLink[];
  ariaLabel?: string;
}) {
  for (const app of apps) {
    preload(app.iconUrl, { as: "image" });
  }

  return (
    <DropdownMenuPrimitive.Root>
      <DropdownMenuPrimitive.Trigger asChild>
        <button type="button" className={menuTriggerClassName} aria-label={ariaLabel}>
          <Grid3X3 className="size-4" aria-hidden="true" />
        </button>
      </DropdownMenuPrimitive.Trigger>
      <DropdownMenuPrimitive.Portal>
        <DropdownMenuPrimitive.Content
          align="end"
          sideOffset={4}
          className={`${menuContentClassName} w-72 p-4 rounded-xl`}
        >
          <div className="grid grid-cols-3 gap-3">
            {apps.map((app) => (
              <DropdownMenuPrimitive.Item key={app.url} asChild>
                <a
                  href={app.url}
                  target="_blank"
                  rel="noreferrer"
                  className={`${menuItemClassName} aspect-square flex-col justify-center gap-2 px-[3px] py-2 text-center font-medium`}
                >
                  <img
                    src={app.iconUrl}
                    alt=""
                    width={38}
                    height={38}
                    className="size-[44px] object-contain"
                  />
                  <span className="w-full truncate font-medium">{app.label}</span>
                </a>
              </DropdownMenuPrimitive.Item>
            ))}
          </div>
        </DropdownMenuPrimitive.Content>
      </DropdownMenuPrimitive.Portal>
    </DropdownMenuPrimitive.Root>
  );
}

export type GdgAccountMenuUser = {
  email: string;
  image?: string | null;
  name: string;
};

export function GdgAccountMenu({
  accountUrl,
  onSignOut,
  settings,
  signOutLabel = "Sign out",
  user,
}: {
  accountUrl: string;
  onSignOut: () => void;
  settings?: { href: string; label: string };
  signOutLabel?: string;
  user: GdgAccountMenuUser;
}) {
  const initials = initialsFor(user);
  const title = user.name || user.email;

  return (
    <DropdownMenuPrimitive.Root>
      <DropdownMenuPrimitive.Trigger asChild>
        <button
          type="button"
          aria-label="Account menu"
          className={menuTriggerClassName}
          title={title}
        >
          <AvatarContent user={user} initials={initials} />
        </button>
      </DropdownMenuPrimitive.Trigger>
      <DropdownMenuPrimitive.Portal>
        <DropdownMenuPrimitive.Content
          align="end"
          sideOffset={4}
          className={`${menuContentClassName} w-56`}
        >
          <DropdownMenuPrimitive.Label className="px-2 py-1.5 text-sm font-medium">
            <div className="flex flex-col">
              <span className="truncate font-medium">{title}</span>
              {user.name ? (
                <span className="truncate text-xs text-muted-foreground">{user.email}</span>
              ) : null}
            </div>
          </DropdownMenuPrimitive.Label>
          <MenuSeparator />
          <MenuItem href={accountUrl} icon={<Settings className="size-4" />}>
            Manage your account
          </MenuItem>
          {settings ? <MenuItem href={settings.href}>{settings.label}</MenuItem> : null}
          <MenuSeparator />
          <DropdownMenuPrimitive.Item onSelect={onSignOut} className={menuItemClassName}>
            <LogOut className="size-4" />
            {signOutLabel}
          </DropdownMenuPrimitive.Item>
        </DropdownMenuPrimitive.Content>
      </DropdownMenuPrimitive.Portal>
    </DropdownMenuPrimitive.Root>
  );
}

const menuItemClassName =
  "relative flex cursor-default items-center gap-2 rounded-xl px-2 py-1.5 text-sm outline-hidden select-none focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 [&_svg:not([class*='text-'])]:text-muted-foreground";

function MenuSeparator() {
  return <DropdownMenuPrimitive.Separator className="-mx-1 my-1 h-px bg-border" />;
}

function AvatarContent({ user, initials }: { user: GdgAccountMenuUser; initials: string }) {
  return (
    <span className="relative flex size-6 shrink-0 overflow-hidden rounded-full">
      {user.image ? (
        <img src={user.image} alt="" className="size-full object-cover" />
      ) : (
        <span className="flex size-full items-center justify-center rounded-full bg-muted text-xs text-muted-foreground">
          {initials || "?"}
        </span>
      )}
    </span>
  );
}

function MenuItem({
  children,
  href,
  icon,
}: {
  children: ReactNode;
  href: string;
  icon?: ReactNode;
}) {
  return (
    <DropdownMenuPrimitive.Item asChild>
      <a href={href} className={menuItemClassName}>
        {icon}
        {children}
      </a>
    </DropdownMenuPrimitive.Item>
  );
}

function initialsFor(user: GdgAccountMenuUser) {
  return (user.name || user.email)
    .split(/\s+|@/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}
