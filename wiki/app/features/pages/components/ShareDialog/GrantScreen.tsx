import { Loader2, Send, Share2 } from "lucide-react";
import { Button } from "~/components/ui/button";
import { MotionPresence } from "~/components/ui/motion";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { type PageRole, ROLES } from "./types";
import type { ShareDialogController } from "./use-share-dialog";

/** The "grant access to selected people" screen. */
export function GrantScreen({ c }: { c: ShareDialogController }) {
  const {
    t,
    notify,
    setNotify,
    grantRole,
    setGrantRole,
    message,
    setMessage,
    error,
    isMutating,
    selected,
    setIsListOpen,
    setScreen,
    grantSelected,
  } = c;

  return (
    <section className="pt-5" aria-label={t("wiki.share_add_people")}>
      <div className="grid gap-4 sm:grid-cols-[1fr_144px] sm:items-start">
        <label className="flex min-h-10 items-center gap-2 text-sm text-muted-foreground">
          <input
            type="checkbox"
            checked={notify}
            onChange={(event) => setNotify(event.target.checked)}
            className="h-5 w-5 accent-primary"
          />
          {t("wiki.share_notify")}
        </label>
        <label className="sr-only" htmlFor="grant-role">
          {t("wiki.share_role")}
        </label>
        <Select value={grantRole} onValueChange={(value) => setGrantRole(value as PageRole)}>
          <SelectTrigger
            id="grant-role"
            aria-label={t("wiki.share_role")}
            className="h-10 w-full rounded-lg bg-background"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent position="popper">
            {ROLES.map((role) => (
              <SelectItem key={role} value={role}>
                {t(`wiki.share_role_${role}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div
        aria-hidden={!notify}
        inert={notify ? undefined : true}
        className={`grid transition-[grid-template-rows,opacity,transform,margin] ease-[var(--motion-ease-out)] motion-reduce:translate-y-0 motion-reduce:transition-[opacity] motion-reduce:duration-100 ${
          notify
            ? "visible mt-5 grid-rows-[1fr] translate-y-0 opacity-100 duration-[240ms]"
            : "invisible mt-0 grid-rows-[0fr] -translate-y-2 opacity-0 duration-[160ms]"
        }`}
      >
        <div className="min-h-0 overflow-hidden">
          <label className="block">
            <span className="sr-only">{t("wiki.share_message")}</span>
            <textarea
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              placeholder={t("wiki.share_message")}
              rows={5}
              disabled={!notify}
              className="w-full resize-none rounded-xl border border-input bg-background px-3 py-2.5 text-sm outline-none transition-[border-color,box-shadow] focus:border-ring focus:ring-2 focus:ring-ring/20"
            />
          </label>
        </div>
      </div>
      <MotionPresence present={Boolean(error)} className="mt-3" distance={-3}>
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      </MotionPresence>
      <footer className="mt-6 flex items-center justify-end gap-3">
        <Button
          variant="ghost"
          onClick={() => {
            setIsListOpen(false);
            setScreen("overview");
          }}
          disabled={isMutating}
          className="text-primary"
        >
          {t("cancel")}
        </Button>
        <Button
          onClick={grantSelected}
          disabled={!selected.length || isMutating}
          className="rounded-full px-5"
        >
          {isMutating ? (
            <Loader2 size={18} className="animate-spin motion-reduce:animate-none" />
          ) : notify ? (
            <Send size={18} />
          ) : (
            <Share2 size={18} />
          )}
          {notify ? t("wiki.share_send") : t("wiki.share")}
        </Button>
      </footer>
    </section>
  );
}
