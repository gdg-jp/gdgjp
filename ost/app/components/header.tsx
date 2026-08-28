import { GdgAccountMenu } from "@gdgjp/gdg-lib/ui";

export type HeaderUser = { name: string; email: string; image: string | null };

/**
 * Admin-surface header: title on the left, the shared GDG account menu
 * (avatar → name/email, manage account, sign out) pinned top-right.
 */
export function Header({
  title,
  accountsUrl,
  user,
}: {
  title: string;
  accountsUrl: string;
  user: HeaderUser;
}) {
  return (
    <header className="flex flex-wrap items-center justify-between gap-4">
      <h1 className="text-2xl font-bold lg:text-3xl">{title}</h1>
      <GdgAccountMenu
        accountUrl={`${accountsUrl}/dashboard`}
        onSignOut={() => window.location.assign("/auth/signout")}
        signOutLabel="ログアウト"
        user={{ name: user.name, email: user.email, image: user.image }}
      />
    </header>
  );
}
