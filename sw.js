self.addEventListener("notificationclick", function(event) {
  event.notification.close();
  event.waitUntil((async function() {
    var windows = await clients.matchAll({ type: "window", includeUncontrolled: true });
    for (var i = 0; i < windows.length; i++) {
      if ("focus" in windows[i]) return windows[i].focus();
    }
    if (clients.openWindow) return clients.openWindow("./");
  })());
});
