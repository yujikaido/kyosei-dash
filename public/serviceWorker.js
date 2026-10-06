self.addEventListener("install", function (event) {
    self.skipWaiting();
});

// Clear old caches from vite-plugin-pwa
self.addEventListener("activate", function (event) {
    event.waitUntil(
        (async function () {
            const cacheNames = await caches.keys();
            for (const cacheName of cacheNames) {
                await caches.delete(cacheName);
            }
            await self.clients.claim();
        })()
    );
});

// A (pass-through) fetch handler must exist for the browser to treat this as an
// installable PWA. We intentionally do not cache: the dashboard is realtime, so
// requests always go to the network and we never serve stale data.
self.addEventListener("fetch", function (event) {
    // No event.respondWith() -> the browser handles the request normally.
});

// Receive push notifications
self.addEventListener("push", function (event) {
    if (self.Notification?.permission !== "granted") {
        console.error("Notifications aren't supported or permission not granted!");
        return;
    }

    if (event.data) {
        let message = event.data.json();
        try {
            self.registration.showNotification(message.title, {
                body: message.body,
            });
        } catch (error) {
            console.error("Failed to show notification:", error);
        }
    }
});
