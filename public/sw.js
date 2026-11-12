/* Cache only the public app shell and immutable assets. Private API data belongs
   in owner-partitioned IndexedDB, never the service-worker response cache. */
const CACHE = "training-shell-v3";
const TIMER_SOUNDS = ["/audio/timer/crisp-v1/tick.wav", "/audio/timer/crisp-v1/start.wav", "/audio/timer/crisp-v1/countdown.wav", "/audio/timer/crisp-v1/finish.wav"];
self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then(async (cache) => {
    await cache.add("/");
    // A transient asset failure must not block installing the offline shell.
    await Promise.allSettled(TIMER_SOUNDS.map((url) => cache.add(url)));
  }));
  self.skipWaiting();
});
self.addEventListener("activate", (event) => {
  event.waitUntil(Promise.all([
    caches.keys().then((keys) => Promise.all(keys.filter((key) => key.startsWith("training-shell-") && key !== CACHE).map((key) => caches.delete(key)))),
    self.clients.claim(),
  ]));
});
self.addEventListener("message", (event) => {
  if (event.data?.type === "training-notification-capability") event.ports[0]?.postMessage({ restTimerPush: 1 });
});
self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;
  if (request.mode === "navigate") {
    event.respondWith(fetch(request).then(async (response) => {
      if (response.ok && url.pathname === "/") {
        const cache = await caches.open(CACHE);
        await cache.put("/", response.clone());
      }
      return response;
    }).catch(async () => (await caches.match("/")) || Response.error()));
    return;
  }
  if (url.pathname.startsWith("/_next/static/") || TIMER_SOUNDS.includes(url.pathname) || ["/training-icon.svg", "/manifest.webmanifest"].includes(url.pathname)) {
    event.respondWith(caches.open(CACHE).then(async (cache) => {
      const cached = await cache.match(request);
      if (cached) return cached;
      const response = await fetch(request);
      if (response.ok) await cache.put(request, response.clone());
      return response;
    }));
  }
});

function visibleOwner(client, payload) {
  if (client.visibilityState !== "visible") return Promise.resolve(false);
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    const finish = (visible) => {
      clearTimeout(timeout);
      channel.port1.close();
      resolve(visible);
    };
    const timeout = setTimeout(() => finish(false), 200);
    channel.port1.onmessage = (event) => finish(event.data?.silent === true);
    try {
      client.postMessage({ type: "training-alert-context", ownerId: payload.ownerId, deviceId: payload.deviceId, timerId: payload.timerId, deadline: payload.deadline }, [channel.port2]);
    } catch { finish(false); }
  });
}
self.addEventListener("push", (event) => {
  event.waitUntil((async () => {
    let payload = {};
    try { payload = event.data?.json() || {}; } catch { /* A received push still needs a visible notification. */ }
    const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true }).catch(() => []);
    const foreground = (await Promise.all(clients.map((client) => visibleOwner(client, payload)))).some(Boolean);
    // Every push displays, including retries. A stable tag replaces a duplicate
    // without alerting again. Foreground audio belongs to the timer itself.
    await self.registration.showNotification(payload.type === "test" ? "Training notifications are on" : "Rest complete", {
      body: payload.type === "test" ? "This phone can notify you when your rest ends." : "Your rest timer has finished.",
      icon: "/training-icon.svg",
      tag: `training-rest-${payload.deviceId || "device"}-${payload.sequence || "timer"}`,
      renotify: false,
      silent: foreground,
      data: { url: typeof payload.url === "string" ? payload.url : "/?tab=week" },
    });
  })());
});
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    const destination = new URL(event.notification.data?.url || "/?tab=week", self.location.origin);
    if (destination.origin !== self.location.origin) return;
    const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const current = clients.find((client) => new URL(client.url).origin === destination.origin);
    if (current) {
      await current.navigate(destination.href);
      await current.focus();
    } else await self.clients.openWindow(destination.href);
  })());
});
