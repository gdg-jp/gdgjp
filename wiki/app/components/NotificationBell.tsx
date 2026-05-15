import { AlertCircle, Bell, BellDot, CheckCircle2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";

function playChime() {
  try {
    const ctx = new AudioContext();
    const freqs = [587.33, 880]; // D5, A5
    let t = ctx.currentTime;
    for (const freq of freqs) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.18, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
      osc.start(t);
      osc.stop(t + 0.08);
      t += 0.1;
    }
  } catch {
    // ignore – autoplay policy or unsupported
  }
}

function AutoDismiss({ onDismiss }: { onDismiss: () => void }) {
  useEffect(() => {
    const timer = setTimeout(onDismiss, 5_000);
    return () => clearTimeout(timer);
  }, [onDismiss]);
  return null;
}

interface Notification {
  id: string;
  type: string;
  titleJa: string;
  titleEn: string;
  refId: string | null;
  refUrl: string | null;
  readAt: string | null;
  createdAt: string;
}

function typeIcon(type: string) {
  switch (type) {
    case "ingestion_done":
      return <CheckCircle2 className="h-4 w-4 shrink-0 text-green-500" />;
    case "ingestion_error":
      return <AlertCircle className="h-4 w-4 shrink-0 text-red-500" />;
    default:
      return <Bell className="h-4 w-4 shrink-0 text-gray-400" />;
  }
}

function relativeTime(t: (key: string, opts?: Record<string, unknown>) => string, iso: string) {
  const timestamp = new Date(iso).getTime();
  if (Number.isNaN(timestamp)) return t("time.just_now");
  const diff = Date.now() - timestamp;
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return t("time.just_now");
  if (mins < 60) return t("time.minutes_ago", { count: mins });
  const hours = Math.floor(mins / 60);
  if (hours < 24) return t("time.hours_ago", { count: hours });
  const days = Math.floor(hours / 24);
  return t("time.days_ago", { count: days });
}

export default function NotificationBell({ initialCount }: { initialCount: number }) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(initialCount);
  const [chipNotification, setChipNotification] = useState<Notification | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const prevUnreadRef = useRef(initialCount);

  const fetchNotifications = useCallback(async () => {
    try {
      const res = await fetch("/api/notifications");
      if (!res.ok) return;
      const data = (await res.json()) as { notifications: Notification[]; unreadCount: number };
      setNotifications(data.notifications);
      const newCount = data.unreadCount;
      setUnreadCount(newCount);
      if (newCount > prevUnreadRef.current) {
        playChime();
        const newest = data.notifications.find((n) => !n.readAt);
        if (newest) setChipNotification(newest);
      }
      prevUnreadRef.current = newCount;
    } catch {
      // ignore fetch errors
    }
  }, []);

  // Click-outside handler
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  // Polling: 30s background, 5s when open; also fetch immediately on each interval reset
  useEffect(() => {
    fetchNotifications();
    const interval = open ? 5_000 : 30_000;
    if (intervalRef.current) clearInterval(intervalRef.current);
    intervalRef.current = setInterval(fetchNotifications, interval);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [open, fetchNotifications]);

  // Fetch immediately when dropdown opens
  useEffect(() => {
    if (open) fetchNotifications();
  }, [open, fetchNotifications]);

  // Sync initialCount on server re-renders
  useEffect(() => {
    setUnreadCount(initialCount);
  }, [initialCount]);

  async function markAsRead(notificationId: string) {
    // Optimistic update
    setNotifications((prev) =>
      prev.map((n) => (n.id === notificationId ? { ...n, readAt: new Date().toISOString() } : n)),
    );
    setUnreadCount((c) => Math.max(0, c - 1));
    try {
      const res = await fetch("/api/notifications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notificationId }),
      });
      if (!res.ok) fetchNotifications();
    } catch {
      // revert on failure
      fetchNotifications();
    }
  }

  async function markAllRead() {
    setNotifications((prev) =>
      prev.map((n) => ({ ...n, readAt: n.readAt ?? new Date().toISOString() })),
    );
    setUnreadCount(0);
    try {
      const res = await fetch("/api/notifications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ markAllRead: true }),
      });
      if (!res.ok) fetchNotifications();
    } catch {
      fetchNotifications();
    }
  }

  const title = (n: Notification) => (i18n.language === "en" ? n.titleEn : n.titleJa);
  const BellIcon = unreadCount > 0 ? BellDot : Bell;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title={t("notifications.title")}
        aria-label={t("notifications.title")}
        className="relative flex items-center justify-center rounded-md p-1.5 text-gray-500 hover:bg-gray-100 hover:text-gray-700"
      >
        <BellIcon className="h-5 w-5" />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-blue-500 px-1 text-[10px] font-bold leading-none text-white">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>

      {chipNotification && (
        <div
          key={chipNotification.id}
          className="fixed right-4 top-16 z-50 flex max-w-[calc(100vw-2rem)] items-center gap-3 rounded-lg border border-gray-200 bg-white px-4 py-3 shadow-lg sm:max-w-xs"
        >
          {typeIcon(chipNotification.type)}
          <p className="min-w-0 flex-1 truncate text-sm font-medium text-gray-800">
            {title(chipNotification)}
          </p>
          <button
            type="button"
            onClick={() => setChipNotification(null)}
            aria-label="Dismiss"
            className="text-gray-400 hover:text-gray-600"
          >
            ×
          </button>
          <AutoDismiss onDismiss={() => setChipNotification(null)} />
        </div>
      )}

      {open && (
        <div className="absolute right-0 top-full z-50 mt-1 w-[calc(100vw-1.5rem)] max-w-72 rounded-md border border-gray-200 bg-white shadow-lg sm:w-72">
          <div className="flex items-center justify-between border-b border-gray-100 px-3 py-2">
            <p className="text-sm font-semibold text-gray-900">{t("notifications.title")}</p>
            {unreadCount > 0 && (
              <button
                type="button"
                onClick={markAllRead}
                className="text-xs text-blue-500 hover:text-blue-700"
              >
                {t("notifications.mark_all_read")}
              </button>
            )}
          </div>

          {notifications.length === 0 ? (
            <div className="px-3 py-6 text-center text-sm text-gray-400">
              {t("notifications.empty")}
            </div>
          ) : (
            <div className="max-h-64 overflow-y-auto">
              {notifications.map((n) => (
                <button
                  key={n.id}
                  type="button"
                  onClick={() => {
                    if (!n.readAt) markAsRead(n.id);
                    setOpen(false);
                    if (n.refUrl) navigate(n.refUrl);
                  }}
                  className={[
                    "flex w-full items-center gap-2.5 px-3 py-2.5 text-left hover:bg-gray-50 dark:hover:bg-gray-700/40",
                    !n.readAt ? "bg-blue-50 dark:bg-blue-900/40" : "",
                  ].join(" ")}
                >
                  {typeIcon(n.type)}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-gray-800">{title(n)}</p>
                    <p className="text-xs text-gray-400">{relativeTime(t, n.createdAt)}</p>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
