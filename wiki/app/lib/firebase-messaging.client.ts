import type { FirebaseApp } from "firebase/app";
import { initializeApp } from "firebase/app";
import { deleteToken, getMessaging, getToken, onMessage } from "firebase/messaging";

export interface FirebaseConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  messagingSenderId: string;
  appId: string;
  vapidKey: string;
}

let app: FirebaseApp | null = null;

function getApp(config: FirebaseConfig): FirebaseApp {
  if (!app) {
    app = initializeApp({
      apiKey: config.apiKey,
      authDomain: config.authDomain,
      projectId: config.projectId,
      messagingSenderId: config.messagingSenderId,
      appId: config.appId,
    });
  }
  return app;
}

function buildSwUrl(config: FirebaseConfig): string {
  const params = new URLSearchParams({
    apiKey: config.apiKey,
    authDomain: config.authDomain,
    projectId: config.projectId,
    messagingSenderId: config.messagingSenderId,
    appId: config.appId,
  });
  return `/firebase-messaging-sw.js?${params.toString()}`;
}

export async function requestPushToken(config: FirebaseConfig): Promise<string> {
  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    throw new Error("Notification permission denied");
  }

  const swRegistration = await navigator.serviceWorker.register(buildSwUrl(config), {
    scope: "/firebase-cloud-messaging-push-scope",
  });

  const firebaseApp = getApp(config);
  const messaging = getMessaging(firebaseApp);

  const token = await getToken(messaging, {
    vapidKey: config.vapidKey,
    serviceWorkerRegistration: swRegistration,
  });

  return token;
}

export async function deletePushToken(config: FirebaseConfig): Promise<void> {
  const firebaseApp = getApp(config);
  const messaging = getMessaging(firebaseApp);
  await deleteToken(messaging);
}

export function setupForegroundHandler(
  config: FirebaseConfig,
  onNotification: (payload: { title?: string; body?: string; url?: string }) => void,
): () => void {
  const firebaseApp = getApp(config);
  const messaging = getMessaging(firebaseApp);
  return onMessage(messaging, (payload) => {
    const data = payload.notification ?? payload.data ?? {};
    onNotification({
      title: data.title as string | undefined,
      body: data.body as string | undefined,
      url: payload.fcmOptions?.link,
    });
  });
}
