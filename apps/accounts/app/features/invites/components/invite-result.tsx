import { Button, Heading, Icons, Stack, Text } from "@gdgjp/design-system";
import { motion, useReducedMotion } from "motion/react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { softSpring, spring } from "~/features/onboarding/components/transitions";
import type { InviteJoinOutcome } from "../types";

export function InviteJoined({ chapters }: { chapters: InviteJoinOutcome[] }) {
  const { t } = useTranslation();
  const reduceMotion = useReducedMotion();
  return (
    <Stack align="center" className="text-center">
      <div className="relative mx-auto grid place-items-center py-2">
        <motion.div
          initial={reduceMotion ? false : { scale: 0.7, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={reduceMotion ? { duration: 0 } : softSpring}
          className="flex size-20 items-center justify-center rounded-full bg-success/15 text-success"
        >
          <Icons name="Check" size={36} aria-hidden="true" />
        </motion.div>
      </div>
      <div className="space-y-2">
        <Heading level={1}>{t("invites.accept.joinedTitle")}</Heading>
        <Text tone="muted" className="mx-auto max-w-md">
          {t("invites.accept.joinedSubtitle")}
        </Text>
      </div>
      <ul className="mx-auto w-full max-w-sm space-y-2 text-left">
        {chapters.map((c, index) => (
          <motion.li
            key={c.id}
            initial={reduceMotion ? false : { opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            transition={reduceMotion ? { duration: 0 } : { ...spring, delay: 0.15 + index * 0.06 }}
            className="flex items-center justify-between gap-3 rounded-md border border-border bg-neutral px-3 py-2.5 text-sm"
          >
            <span className="truncate font-medium">{c.name}</span>
            <span className="inline-flex shrink-0 items-center gap-1 text-xs text-success">
              <Icons name={c.joined ? "Sparkles" : "Check"} size={12} aria-hidden="true" />
              {c.joined ? t("invites.accept.joined") : t("invites.accept.alreadyMember")}
            </span>
          </motion.li>
        ))}
      </ul>
      <Button asChild size="lg" fullWidth className="sm:w-auto sm:min-w-44">
        <Link to="/dashboard">{t("invites.accept.dashboard")}</Link>
      </Button>
    </Stack>
  );
}

export function InviteUnavailable({ reason }: { reason: "invalid" | "expired" | "revoked" }) {
  const { t } = useTranslation();
  return (
    <Stack align="center" className="text-center">
      <div className="flex size-20 items-center justify-center rounded-full bg-neutral text-muted">
        <Icons name="Link" size={32} aria-hidden="true" />
      </div>
      <div className="space-y-2">
        <Heading level={1}>{t("invites.accept.unavailableTitle")}</Heading>
        <Text tone="muted" className="mx-auto max-w-md">
          {t(`invites.accept.reason.${reason}`)}
        </Text>
      </div>
      <Button asChild variant="outline">
        <Link to="/">{t("invites.accept.home")}</Link>
      </Button>
    </Stack>
  );
}
