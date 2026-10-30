// Web Push service worker. Only handles push + notificationclick.
// No offline caching — we rely on Next's own caching strategy.

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  if (!event.data) return;
  let payload;
  try {
    payload = event.data.json();
  } catch (error) {
    payload = { title: "Notification", body: event.data.text(), href: null, icon: null, tag: "fallback" };
  }

  const title = typeof payload.title === "string" && payload.title.length > 0
    ? payload.title
    : "New notification";
  const body = typeof payload.body === "string" ? payload.body.slice(0, 240) : "";
  const icon = typeof payload.icon === "string" && payload.icon.length > 0 ? payload.icon : "/icon-paper-192.png";
  const tag = typeof payload.tag === "string" && payload.tag.length > 0 ? payload.tag : "notification";
  const href = typeof payload.href === "string" ? payload.href : null;

  event.waitUntil(
    (async () => {
      // A chat push for the conversation already open in a focused tab: the reader sees it there.
      if (tag.startsWith("chat:")) {
        const path = "/messages/" + tag.slice("chat:".length);
        const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
        const reading = windows.some((client) => {
          try {
            return client.focused && client.visibilityState === "visible" && new URL(client.url).pathname === path;
          } catch (error) {
            return false;
          }
        });
        if (reading) return;
      }
      await self.registration.showNotification(title, {
        body,
        icon,
        tag,
        // Chat pushes share a per-conversation tag (one notification per conversation): a new message alerts again.
        renotify: tag.startsWith("chat:"),
        badge: "/icon-paper-64.png",
        data: { href, id: payload.id || null, actorUserId: payload.actorUserId || null },
        requireInteraction: false,
      });
    })(),
  );
});

// Ask an open tab to route in-app (no reload); it answers on the port. No answer in 1s: the caller navigates.
function askToNavigate(client, href) {
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    const timer = setTimeout(() => resolve(false), 1000);
    channel.port1.onmessage = () => {
      clearTimeout(timer);
      resolve(true);
    };
    client.postMessage({ type: "nb:navigate", href }, [channel.port2]);
  });
}

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const href = event.notification.data && event.notification.data.href;
  let targetUrl = self.location.origin + "/";
  if (typeof href === "string" && href && !href.startsWith("//") && (href.startsWith("/") || /^https?:\/\//i.test(href)) && !/[\u0000-\u0020\u007f\\]/.test(href)) {
    try {
      const target = new URL(href, self.location.origin);
      if (/^https?:$/.test(target.protocol) && target.origin === self.location.origin && !target.username && !target.password) targetUrl = target.href;
    } catch { /* Malformed notification targets fall back to the application. */ }
  }

  event.waitUntil(
    (async () => {
      const allClients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      // The focused tab first, then any other tab of this site.
      allClients.sort((a, b) => Number(b.focused) - Number(a.focused));
      for (const client of allClients) {
        try {
          const url = new URL(client.url);
          if (url.origin === self.location.origin) {
            await client.focus();
            const target = new URL(targetUrl);
            if (await askToNavigate(client, target.pathname + target.search + target.hash)) return;
            if ("navigate" in client && typeof client.navigate === "function") {
              try {
                await client.navigate(targetUrl);
              } catch (error) {
                // best effort
              }
            }
            return;
          }
        } catch (error) {
          // ignore
        }
      }
      await self.clients.openWindow(targetUrl);
    })(),
  );
});
