import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
  AlertDialogTrigger,
  Button,
  Stack,
} from "@gdgjp/ui";
import { useTranslation } from "react-i18next";
import { Form, useNavigation } from "react-router";

export function ConfirmAction({
  intent,
  icon,
  trigger,
  title,
  description,
  confirm,
  destructive = false,
  toolbar = false,
}: {
  intent: string;
  icon: React.ReactNode;
  trigger: string;
  title: string;
  description: string;
  confirm: string;
  destructive?: boolean;
  toolbar?: boolean;
}) {
  const { t } = useTranslation();
  const navigation = useNavigation();
  const pending = navigation.state !== "idle" && navigation.formData?.get("intent") === intent;
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button
          variant={toolbar ? "ghost" : destructive ? "danger" : "outline"}
          size="sm"
          className={toolbar ? "text-danger hover:text-danger" : undefined}
        >
          {icon} {trigger}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <Stack className="gap-2">
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </Stack>
        <div className="flex flex-wrap justify-end gap-3">
          <AlertDialogCancel asChild>
            <Button type="button" variant="outline">
              {t("developerApps.dialog.cancel")}
            </Button>
          </AlertDialogCancel>
          <Form method="post">
            <input type="hidden" name="intent" value={intent} />
            <AlertDialogAction asChild>
              <Button type="submit" variant={destructive ? "danger" : "primary"} loading={pending}>
                {confirm}
              </Button>
            </AlertDialogAction>
          </Form>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  );
}
