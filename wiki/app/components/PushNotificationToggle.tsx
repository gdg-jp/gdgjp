import { Bell, BellOff } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useFirebaseConfig } from "~/lib/firebase-config-context";

type PushState = "loading" | "unsupported" | "denied" | "enabled" | "disabled";

export function PushNotificationToggle() {
  const { t } = useTranslation();
  const firebaseConfig = useFirebaseConfig();
  const [state, setState] = useState<PushState>("loading");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!firebaseConfig || typeof window === "undefined") {
      setState("unsupported");
      return;
    }
    if (!("Notification" in window) || !("serviceWorker" in navigator)) {
      setState("unsupported");
      return;
    }
    if (Notification.permission === "denied") {
      setState("denied");
      return;
    }

    // Check server for current status
    fetch("/api/fcm-tokens")
      .then((res) => res.json())
      .then((data) => {
        const { enabled } = data as { enabled: boolean };
        setState(enabled ? "enabled" : "disabled");
      })
      .catch(() => setState("disabled"));
  }, [firebaseConfig]);

  const handleEnable = useCallback(async () => {
    if (!firebaseConfig) return;
    setBusy(true);
    try {
      const { requestPushToken } = await import("~/lib/firebase-messaging.client");
      const token = await requestPushToken(firebaseConfig);
      await fetch("/api/fcm-tokens", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ intent: "register", token }),
      });
      setState("enabled");
    } catch (err) {
      console.error("[push] enable failed:", err);
      if (Notification.permission === "denied") {
        setState("denied");
      }
    } finally {
      setBusy(false);
    }
  }, [firebaseConfig]);

  const handleDisable = useCallback(async () => {
    if (!firebaseConfig) return;
    setBusy(true);
    try {
      const { deletePushToken } = await import("~/lib/firebase-messaging.client");
      await deletePushToken(firebaseConfig).catch(() => {});
      await fetch("/api/fcm-tokens", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ intent: "unregister-all" }),
      });
      setState("disabled");
    } catch (err) {
      console.error("[push] disable failed:", err);
    } finally {
      setBusy(false);
    }
  }, [firebaseConfig]);

  if (state === "loading") {
    return (
      <div className="flex items-center gap-3 text-sm text-gray-400">
        <Bell className="h-4 w-4" />
        <span>{t("settings.push.loading")}</span>
      </div>
    );
  }

  if (state === "unsupported") {
    return (
      <div className="flex items-center gap-3 text-sm text-gray-400">
        <BellOff className="h-4 w-4" />
        <span>{t("settings.push.unsupported")}</span>
      </div>
    );
  }

  if (state === "denied") {
    return (
      <div className="flex items-center gap-3 text-sm text-gray-400">
        <BellOff className="h-4 w-4" />
        <span>{t("settings.push.denied")}</span>
      </div>
    );
  }

  const isEnabled = state === "enabled";

  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        disabled={busy}
        onClick={isEnabled ? handleDisable : handleEnable}
        className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-60 ${
          isEnabled ? "bg-blue-500" : "bg-gray-200"
        }`}
        role="switch"
        aria-checked={isEnabled}
      >
        <span
          className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow ring-0 transition-transform duration-200 ${
            isEnabled ? "translate-x-5" : "translate-x-0"
          }`}
        />
      </button>
      <span className="text-sm text-gray-700">
        {isEnabled ? t("settings.push.enabled") : t("settings.push.disabled")}
      </span>
    </div>
  );
}
