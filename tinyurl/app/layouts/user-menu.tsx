import { GdgAccountMenu, GdgAppLauncher } from "@gdgjp/gdg-lib/ui";

export type UserMenuUser = {
  email: string;
  image: string | null;
  name: string;
};

export function UserMenu({
  launcherPosition = "left",
  user,
}: {
  launcherPosition?: "left" | "right";
  user: UserMenuUser | null;
}) {
  if (!user) return null;

  function signOut() {
    window.location.assign("/auth/signout");
  }

  return (
    <div className="flex items-center gap-1">
      {launcherPosition === "left" ? <GdgAppLauncher /> : null}
      <GdgAccountMenu
        accountUrl="https://accounts.gdgs.jp/dashboard"
        onSignOut={signOut}
        user={user}
      />
      {launcherPosition === "right" ? <GdgAppLauncher /> : null}
    </div>
  );
}
