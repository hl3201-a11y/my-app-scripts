/* 食光盒 Service Worker —— 缓存应用壳，实现秒开与离线（体积恒定，不随数据增长） */
const CACHE = 'sg-box-v2';
const SHELL = [
  './', './index.html', './manifest.webmanifest',
  './assets/styles.css', './assets/db.js', './assets/shelf.js', './assets/app.js',
  './assets/icon192.png', './assets/icon512.png'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  e.respondWith(
    caches.match(req).then(hit => {
      if (hit) return hit;
      return fetch(req).then(res => {
        // 仅缓存同源静态资源
        if (res && res.ok && new URL(req.url).origin === self.location.origin) {
          const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy));
        }
        return res;
      }).catch(() => hit);
    })
  );
});
