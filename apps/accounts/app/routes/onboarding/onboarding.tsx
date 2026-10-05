import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { GdgMark } from "~/components/gdg-mark";
import { LocaleSwitcher } from "~/components/locale-switcher";
import { ThemeToggle } from "~/components/theme-toggle";
import { OnboardingWizard } from "~/features/onboarding/components/onboarding-wizard";
import { actOnOnboarding, loadOnboarding } from "~/features/onboarding/onboarding.server";
import type { RouteData } from "~/lib/route-data";
import type { Route } from "./+types/onboarding";

export function meta({ data }: Route.MetaArgs) {
  return [{ title: data?.title }];
}

export function loader(args: Route.LoaderArgs) {
  return loadOnboarding(args);
}

export function action(args: Route.ActionArgs) {
  return actOnOnboarding(args);
}

type PageProps = {
  loaderData: RouteData<typeof loadOnboarding>;
  actionData?: RouteData<typeof actOnOnboarding>;
};

export default function OnboardingPage({ loaderData }: PageProps) {
  const { t } = useTranslation();

  return (
    <div className="min-h-dvh bg-background">
      <div className="absolute top-4 right-4 z-10 flex items-center gap-2">
        <LocaleSwitcher />
        <ThemeToggle />
      </div>

      <main className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col px-4 py-10 sm:py-14">
        <div>
          <Link
            to="/dashboard"
            className="mb-8 inline-flex w-fit items-center gap-3 rounded-md px-3 py-2 pr-4"
            aria-label={loaderData.user.name}
          >
            <GdgMark size="sm" />
            <span className="text-sm font-medium tracking-tight">{t("app.name")}</span>
          </Link>
        </div>
        <OnboardingWizard chapters={loaderData.chapters} />
      </main>
    </div>
  );
}
