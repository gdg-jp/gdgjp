import { Check, Copy, Loader2 } from "lucide-react";
import { Button } from "~/components/ui/button";
import { MotionPresence, MotionSwap } from "~/components/ui/motion";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { AccessIcon, Avatar } from "./avatar";
import { GENERAL_ACCESS, type GeneralAccess, type PageRole, ROLES } from "./types";
import type { ShareDialogController } from "./use-share-dialog";

/** The default screen: people-with-access list, general access, copy-link footer. */
export function OverviewScreen({ c }: { c: ShareDialogController }) {
  const {
    t,
    isLoading,
    ownerSubject,
    accessList,
    canManage,
    isMutating,
    changeAccess,
    accessFetcher,
    localAccess,
    localGeneralRole,
    setGeneralAccess,
    syncWithParent,
    error,
    warning,
    copied,
    copyLink,
    close,
  } = c;

  return (
    <>
      <section className="pt-5">
        <h3 className="mb-3 text-base">{t("wiki.share_people_with_access")}</h3>
        {isLoading ? (
          <div className="flex justify-center py-6">
            <Loader2 className="animate-spin text-muted-foreground motion-reduce:animate-none" />
          </div>
        ) : (
          <ul className="space-y-3">
            {ownerSubject && (
              <li className="flex items-center gap-3">
                <Avatar subject={ownerSubject} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-base">{ownerSubject.label}</p>
                  {ownerSubject.secondary && (
                    <p className="truncate text-sm text-muted-foreground">
                      {ownerSubject.secondary}
                    </p>
                  )}
                </div>
                <span className="text-base text-muted-foreground">
                  {t("wiki.share_role_owner")}
                </span>
              </li>
            )}
            {accessList.map((entry) => (
              <li key={entry.id} className="flex items-center gap-3">
                <Avatar subject={entry} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-base">{entry.label}</p>
                  <p className="truncate text-sm text-muted-foreground">{entry.secondary}</p>
                </div>
                {canManage ? (
                  <>
                    <label className="sr-only" htmlFor={`role-${entry.id}`}>
                      {t("wiki.share_role")}
                    </label>
                    <Select
                      value={entry.role}
                      disabled={isMutating}
                      onValueChange={(value) => changeAccess(entry, value)}
                    >
                      <SelectTrigger
                        id={`role-${entry.id}`}
                        aria-label={t("wiki.share_role")}
                        size="sm"
                        className="max-w-36 rounded-lg bg-background"
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent position="popper" align="end">
                        {ROLES.map((role) => (
                          <SelectItem key={role} value={role}>
                            {t(`wiki.share_role_${role}`)}
                          </SelectItem>
                        ))}
                        <SelectSeparator />
                        {accessFetcher.data?.myRole === "owner" &&
                          entry.type === "email" &&
                          entry.userId && (
                            <SelectItem value="transfer">{t("wiki.share_transfer")}</SelectItem>
                          )}
                        <SelectItem value="remove" className="text-destructive">
                          {t("wiki.share_remove")}
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </>
                ) : (
                  <span className="text-sm text-muted-foreground">
                    {t(`wiki.share_role_${entry.role}`)}
                  </span>
                )}
              </li>
            ))}
            {!ownerSubject && accessList.length === 0 && (
              <li className="text-sm text-muted-foreground">{t("wiki.share_no_access")}</li>
            )}
          </ul>
        )}
      </section>

      {canManage && (
        <section className="mt-6">
          <h3 className="mb-3 text-base">{t("wiki.share_general_access")}</h3>
          <div className="flex flex-wrap items-center gap-3 sm:flex-nowrap">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-secondary text-secondary-foreground shadow-sm">
              <AccessIcon value={localAccess} />
            </span>
            <label className="sr-only" htmlFor="general-access">
              {t("wiki.share_general_access")}
            </label>
            <div className="min-w-0 flex-1">
              <div className="inline-flex max-w-full items-center">
                <Select
                  value={localAccess}
                  disabled={isMutating}
                  onValueChange={(value) => setGeneralAccess(value as GeneralAccess)}
                >
                  <SelectTrigger
                    id="general-access"
                    aria-label={t("wiki.share_general_access")}
                    className="h-9 max-w-full border-0 bg-transparent px-2 shadow-none hover:bg-accent"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent position="popper" align="start">
                    {GENERAL_ACCESS.map(({ value, icon: Icon }) => (
                      <SelectItem key={value} value={value}>
                        <Icon aria-hidden="true" />
                        {t(`wiki.share_access_${value}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                {t(`wiki.share_access_${localAccess}_desc`)}
              </p>
            </div>
            {localAccess !== "restricted" && (
              <div className="ml-auto shrink-0">
                <label htmlFor="general-role" className="sr-only">
                  {t("wiki.share_general_role")}
                </label>
                <Select
                  value={localGeneralRole}
                  disabled={isMutating}
                  onValueChange={(value) => setGeneralAccess(localAccess, value as PageRole)}
                >
                  <SelectTrigger
                    id="general-role"
                    aria-label={t("wiki.share_general_role")}
                    className="h-9 rounded-lg border-0 bg-transparent shadow-none hover:bg-accent"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent position="popper" align="end">
                    {ROLES.map((role) => (
                      <SelectItem key={role} value={role}>
                        {t(`wiki.share_role_${role}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
          {accessFetcher.data?.parentId && !accessFetcher.data.aclSyncedWithParent && (
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground">
              <span>{t("wiki.share_parent_acl_not_synced")}</span>
              <Button
                variant="outline"
                size="sm"
                onClick={syncWithParent}
                disabled={isMutating}
                className="rounded-full"
              >
                {isMutating && (
                  <Loader2 className="animate-spin motion-reduce:animate-none" size={16} />
                )}
                {t("wiki.share_sync_now")}
              </Button>
            </div>
          )}
        </section>
      )}
      <MotionPresence present={Boolean(error || warning)} className="mt-4" distance={-3}>
        <p role={error ? "alert" : "status"} className="text-sm text-destructive">
          {error ?? warning}
        </p>
      </MotionPresence>
      <footer className="mt-6 flex items-center justify-between border-t border-border pt-4">
        <Button variant="outline" onClick={copyLink} className="rounded-full text-primary">
          <MotionSwap
            as="span"
            stateKey={copied ? "copied" : "copy"}
            distance={0}
            enterDuration={140}
            className="inline-flex items-center gap-2"
          >
            {copied ? <Check size={20} /> : <Copy size={20} />}
            {copied ? t("wiki.share_copied") : t("wiki.share_copy_link")}
          </MotionSwap>
        </Button>
        <Button onClick={close} disabled={isMutating} className="rounded-full px-5">
          {t("wiki.share_done")}
        </Button>
      </footer>
    </>
  );
}
