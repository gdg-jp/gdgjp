/* eslint-disable no-undef */
// Firebase Messaging Service Worker — handles background push notifications.
// Uses compat SDK via importScripts (service workers can't use ES modules universally).

importScripts("https://www.gstatic.com/firebasejs/11.8.1/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/11.8.1/firebase-messaging-compat.js");

// The service worker reads config from the query string set during registration.
// This avoids hardcoding project-specific values.
const url = new URL(self.location.href);
const config = {
  apiKey: url.searchParams.get("apiKey"),
  authDomain: url.searchParams.get("authDomain"),
  projectId: url.searchParams.get("projectId"),
  messagingSenderId: url.searchParams.get("messagingSenderId"),
  appId: url.searchParams.get("appId"),
};

firebase.initializeApp(config);

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  const data = payload.notification || payload.data || {};
  const title = data.title || "GDG Japan Wiki";
  const options = {
    body: data.body || "",
    icon: "/favicon.ico",
    data: { url: payload.fcmOptions?.link || "/" },
  };
  self.registration.showNotification(title, options);
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || "/";
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((windowClients) => {
      for (const client of windowClients) {
        if (client.url === targetUrl && "focus" in client) {
          return client.focus();
        }
      }
      return clients.openWindow(targetUrl);
    }),
  );
});
