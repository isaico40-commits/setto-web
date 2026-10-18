/* Service worker de Setto: solo para las notificaciones (pedido, drops y avisos del panel). No guarda nada en caché. */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("push", (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (_) { d = { body: e.data && e.data.text() }; }
  e.waitUntil(self.registration.showNotification(d.title || "Setto", {
    body: d.body || "Hay novedades en tu pedido.",
    icon: "/img/icon-192.png",
    badge: "/img/icon-192.png",
    tag: d.tag || "setto-pedido",
    renotify: true,
    data: { url: d.url || (d.track ? `/?seguir=${encodeURIComponent(d.track)}` : "/") },
  }));
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || "/", self.location.origin).href;
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const mismo = (c) => new URL(c.url).origin === self.location.origin;
    const panel = url.includes("/panel"), esPanel = (c) => new URL(c.url).pathname.startsWith("/panel");
    // un aviso del panel abre el panel (si ya está abierto, lo trae adelante); uno del cliente, el sitio
    const w = wins.find((c) => mismo(c) && esPanel(c) === panel) || (!panel && wins.find(mismo));
    if (w) {
      await w.focus();
      try { return w.navigate ? await w.navigate(url) : null; } catch (_) { return null; }
    }
    return self.clients.openWindow(url);
  })());
});
