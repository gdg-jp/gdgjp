# notifications

Outbound notifications: in-app, email, and web push (FCM).

- `notify.server.ts` — the fan-out entry; writes `notifications` rows and calls `fcm.server`.
- `email.server.ts` — transactional email (HTML templates carry literal colours by design).
- `fcm.server.ts` — server-side FCM send. `firebase-messaging.client.ts` — browser token register/delete (dynamic-imported).
- `firebase-config-context.ts` — React context for the public Firebase config. `components/` — `NotificationBell`, `PushNotificationToggle`.
