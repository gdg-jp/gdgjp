import { Badge, Card, Stack } from "@gdgjp/design-system";
import { useTranslation } from "react-i18next";
import { useActionData, useNavigation } from "react-router";
import { GdgMark } from "~/components/gdg-mark";
import { LocaleSwitcher } from "~/components/locale-switcher";
import { ThemeToggle } from "~/components/theme-toggle";
import { DeviceBody } from "~/features/oauth/components/device-body";
import type { ActionResult } from "~/features/oauth/device-shared";
import { actOnDevice, loadDevice } from "~/features/oauth/device.server";
import type { RouteData } from "~/lib/route-data";
import type { Route } from "./+types/device";

export function meta({ data }: Route.MetaArgs) {
  return [{ title: data?.title }];
}

export function loader(args: Route.LoaderArgs) {
  return loadDevice(args);
}

export function action(args: Route.ActionArgs) {
  return actOnDevice(args);
}

type PageProps = {
  loaderData: RouteData<typeof loadDevice>;
  actionData?: RouteData<typeof actOnDevice>;
};

export default function DevicePage({ loaderData }: PageProps) {
  const { t } = useTranslation();
  const actionData = useActionData<ActionResult>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state !== "idle";
  const submittedIntent = navigation.formData?.get("intent");

  return (
    <div className="min-h-dvh bg-background">
      <div className="absolute top-4 right-4 flex items-center gap-2">
        <LocaleSwitcher />
        <ThemeToggle />
      </div>

      <main className="grid min-h-dvh place-items-center px-4 py-10">
        <Card className="w-full max-w-lg">
          <Stack align="start" className="gap-4 sm:flex-row">
            <GdgMark size="md" />
            <Badge tone="info">{t("auth.device.eyebrow")}</Badge>
          </Stack>
          <div className="mt-6">
            <DeviceBody
              userCode={loaderData.userCode}
              pending={loaderData.pending}
              actionResult={actionData}
              isSubmitting={isSubmitting}
              submittedIntent={typeof submittedIntent === "string" ? submittedIntent : null}
            />
          </div>
        </Card>
      </main>
    </div>
  );
}
