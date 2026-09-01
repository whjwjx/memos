export type BrowserPushSubscriptionInput = {
  endpoint: string;
  p256dh: string;
  auth: string;
  userAgent: string;
};

export const isBrowserPushSupported = () => {
  return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
};

export const getNotificationPermission = (): NotificationPermission | "unsupported" => {
  if (!("Notification" in window)) {
    return "unsupported";
  }
  return Notification.permission;
};

export const registerPushServiceWorker = async () => {
  if (!isBrowserPushSupported()) {
    throw new Error("Browser push is not supported");
  }
  return navigator.serviceWorker.register("/sw.js");
};

export const getExistingBrowserPushSubscription = async () => {
  if (!isBrowserPushSupported()) {
    return undefined;
  }
  const registration = await navigator.serviceWorker.getRegistration();
  return registration?.pushManager.getSubscription();
};

export const subscribeBrowserPush = async (vapidPublicKey: string) => {
  const registration = await registerPushServiceWorker();
  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    throw new Error("Notification permission was not granted");
  }
  const applicationServerKey = base64URLToUint8Array(vapidPublicKey);
  const existingSubscription = await registration.pushManager.getSubscription();
  if (existingSubscription) {
    if (pushSubscriptionMatchesApplicationServerKey(existingSubscription, applicationServerKey)) {
      return existingSubscription;
    }
    await existingSubscription.unsubscribe();
  }
  return registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey,
  });
};

export const unsubscribeBrowserPush = async () => {
  const subscription = await getExistingBrowserPushSubscription();
  if (!subscription) {
    return;
  }
  await subscription.unsubscribe();
};

export const showLocalBrowserNotification = async () => {
  if (!isBrowserPushSupported()) {
    throw new Error("Browser push is not supported");
  }
  await registerPushServiceWorker();
  const permission = getNotificationPermission() === "granted" ? "granted" : await Notification.requestPermission();
  if (permission !== "granted") {
    throw new Error("Notification permission was not granted");
  }

  const registration = await navigator.serviceWorker.ready;
  await registration.showNotification("Memos local test", {
    body: "If this notification appears, Chrome and system notifications are working.",
    icon: "/logo.webp",
    badge: "/logo.webp",
    tag: `memos-local-${Date.now()}`,
    requireInteraction: true,
  });
};

export const browserPushSubscriptionToInput = (subscription: PushSubscription): BrowserPushSubscriptionInput => {
  const json = subscription.toJSON();
  return {
    endpoint: json.endpoint || subscription.endpoint,
    p256dh: json.keys?.p256dh || "",
    auth: json.keys?.auth || "",
    userAgent: navigator.userAgent,
  };
};

const base64URLToUint8Array = (base64URL: string) => {
  const padding = "=".repeat((4 - (base64URL.length % 4)) % 4);
  const base64 = `${base64URL}${padding}`.replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
};

const pushSubscriptionMatchesApplicationServerKey = (subscription: PushSubscription, applicationServerKey: Uint8Array) => {
  const existingKey = subscription.options.applicationServerKey;
  if (!existingKey) {
    return true;
  }
  const existingBytes = bufferSourceToUint8Array(existingKey);
  if (existingBytes.length !== applicationServerKey.length) {
    return false;
  }
  return existingBytes.every((byte, index) => byte === applicationServerKey[index]);
};

const bufferSourceToUint8Array = (source: BufferSource) => {
  if (source instanceof ArrayBuffer) {
    return new Uint8Array(source);
  }
  return new Uint8Array(source.buffer, source.byteOffset, source.byteLength);
};
