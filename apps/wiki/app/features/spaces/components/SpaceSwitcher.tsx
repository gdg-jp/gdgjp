import {
  Icons,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
} from "@gdgjp/design-system";
import { useId } from "react";
import { useTranslation } from "react-i18next";
import { Link, useFetcher, useNavigate } from "react-router";
import { spacePath } from "../shared";
import { type SpaceSummary, useCurrentSpace } from "./current-space";

/** Sidebar header: which space the tree shows, and a link to the space list. */
export function SpaceSwitcher({
  spaces,
  isCollapsed,
}: {
  spaces: readonly SpaceSummary[];
  isCollapsed: boolean;
}) {
  const { t } = useTranslation();
  const current = useCurrentSpace();
  const navigate = useNavigate();
  if (isCollapsed) {
    return (
      <Link
        to="/spaces"
        title={current.name}
        aria-label={t("spaces.switcher_label")}
        className="flex justify-center rounded-md p-2 text-muted hover:bg-neutral hover:text-foreground"
      >
        <Icons name="Layers" size={16} />
      </Link>
    );
  }
  return (
    <div className="flex items-center gap-1 px-2 pt-3">
      <Select value={current.slug} onValueChange={(slug) => navigate(spacePath(slug))}>
        <SelectTrigger className="min-w-0 flex-1" aria-label={t("spaces.switcher_label")}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent position="popper">
          {(spaces.length > 0 ? spaces : [current]).map((space) => (
            <SelectItem key={space.id} value={space.slug}>
              {space.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Link
        to="/spaces"
        aria-label={t("spaces.manage")}
        title={t("spaces.manage")}
        className="shrink-0 rounded-md p-2 text-muted hover:bg-neutral hover:text-foreground"
      >
        <Icons name="Settings" size={16} />
      </Link>
    </div>
  );
}

/** "Hide agent-written pages" — a display preference, not a permission. */
export function HideAgentPagesToggle({ hideAgentPages }: { hideAgentPages: boolean }) {
  const { t } = useTranslation();
  const fetcher = useFetcher();
  const switchId = useId();
  const pending = fetcher.formData?.get("hideAgentPages");
  const checked = pending === undefined || pending === null ? hideAgentPages : pending === "true";
  return (
    <div className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
      <label htmlFor={switchId} className="text-muted">
        {t("spaces.hide_agent_pages")}
      </label>
      <Switch
        id={switchId}
        checked={checked}
        onCheckedChange={(value) =>
          fetcher.submit(
            { hideAgentPages: String(value) },
            { method: "POST", action: "/api/user/preferences" },
          )
        }
      />
    </div>
  );
}
