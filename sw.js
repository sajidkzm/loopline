self.addEventListener("push", function(event) {
  var payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch (error) {
    payload = { body: event.data ? event.data.text() : "" };
  }

  var title = payload.title || "Loopline";
  var options = {
    body: payload.body || "You have an update in Loopline.",
    icon: "./icons/icon-192.png",
    badge: "./icons/badge-72.png",
    tag: payload.tag || "loopline-update",
    renotify: false,
    data: { url: payload.url || "./" }
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", function(event) {
  event.notification.close();
  var target = new URL(
    event.notification.data && event.notification.data.url
      ? event.notification.data.url
      : "./",
    self.location.origin
  );

  if (target.origin !== self.location.origin) target.href = self.registration.scope;

  event.waitUntil((async function() {
    var windows = await clients.matchAll({ type: "window", includeUncontrolled: true });
    for (var i = 0; i < windows.length; i++) {
      if (new URL(windows[i].url).origin === self.location.origin && "focus" in windows[i]) {
        await windows[i].focus();
        if ("navigate" in windows[i] && windows[i].url !== target.href) {
          return windows[i].navigate(target.href);
        }
        return;
      }
    }
    if (clients.openWindow) return clients.openWindow(target.href);
  })());
});
