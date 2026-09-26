// Offline support: network first (so updates show up immediately), cache as fallback.
const CACHE = 'daybook-v2';
const SHELL = [
  './', 'index.html', 'manifest.webmanifest', 'css/app.css',
  'js/main.js', 'js/store.js', 'js/sync.js', 'js/dates.js', 'js/ui.js', 'js/charts.js', 'js/models.js',
  'js/editors.js', 'js/theme.js', 'js/intents.js', 'js/voice.js', 'js/routes.js', 'js/gamify.js', 'js/vices.js', 'js/social.js', 'js/share.js', 'js/install.js', 'js/graph.js', 'js/md.js', 'js/vault.js', 'js/views/brain.js',
  'js/gym/exercises.js', 'js/gym/model.js',
  'js/views/today.js', 'js/views/calendar.js', 'js/views/tasks.js', 'js/views/reading.js',
  'js/views/habits.js', 'js/views/expenses.js', 'js/views/news.js', 'js/views/settings.js',
  'js/views/notes.js', 'js/views/gym.js', 'js/views/goals.js', 'js/views/learnings.js', 'js/views/watch.js',
  'js/views/routine.js', 'js/views/screen.js', 'js/views/stats.js', 'js/views/friends.js',
  'js/agent.js', 'js/views/agent.js',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const network = fetch(req).then((res) => {
      if (res.ok) cache.put(req, res.clone());
      return res;
    });
    // Don't let a slow connection hold the app hostage: fall back to cache after 2.5s.
    network.catch(() => {});
    const timeout = new Promise((resolve) => setTimeout(resolve, 2500));
    try {
      const res = await Promise.race([network, timeout]);
      if (res) return res;
      return (await cache.match(req, { ignoreSearch: true })) || (await network);
    } catch {
      const hit = await cache.match(req, { ignoreSearch: true });
      if (hit) return hit;
      if (req.mode === 'navigate') return cache.match('index.html');
      throw new Error('offline');
    }
  })());
});

// Notifications from the agent (sent by agent/run.mjs through the browser's push service).
self.addEventListener('push', (e) => {
  let msg = {};
  try { msg = e.data ? e.data.json() : {}; } catch { msg = { body: e.data?.text() }; }
  e.waitUntil(self.registration.showNotification(msg.title || 'Daybook', {
    body: msg.body || '', tag: msg.tag || 'daybook', icon: 'icons/icon-192.png', badge: 'icons/icon-192.png',
    data: { url: msg.url || '#/agent' },
  }));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = new URL(`./${e.notification.data?.url || ''}`, self.registration.scope).href;
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const win = wins.find((c) => c.url.startsWith(self.registration.scope));
    if (win) { await win.focus(); return win.navigate(url).catch(() => {}); }
    return self.clients.openWindow(url);
  })());
});
