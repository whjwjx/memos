self.addEventListener("push", (event) => {
  let payload = {};
  if (event.data) {
    try {
      payload = event.data.json();
    } catch {
      payload = { body: event.data.text() };
    }
  }

  const title = payload.title || "Memos reminder";
  const options = {
    body: payload.body || "A scheduled memo is due.",
    icon: "/logo.webp",
    badge: "/logo.webp",
    tag: payload.tag,
    data: {
      url: payload.url || "/calendar",
    },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetURL = new URL(event.notification.data?.url || "/calendar", self.location.origin).href;

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ("focus" in client && client.url === targetURL) {
          return client.focus();
        }
      }
      return self.clients.openWindow(targetURL);
    }),
  );
});
