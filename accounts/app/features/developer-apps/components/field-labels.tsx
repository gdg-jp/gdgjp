import { useTranslation } from "react-i18next";

export function RequiredLabel() {
  const { t } = useTranslation();
  return (
    <span className="text-xs font-normal text-muted">({t("developerApps.form.required")})</span>
  );
}

export function RequiredMark() {
  return (
    <span className="text-danger" aria-hidden="true">
      *
    </span>
  );
}

export function OptionalLabel() {
  const { t } = useTranslation();
  return (
    <span className="text-xs font-normal text-muted">({t("developerApps.form.optional")})</span>
  );
}
