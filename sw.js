// ═══════════════════════════════════════════════════════
// 格蘭朵魔法森林 Service Worker
// 策略：network first，失敗才用快取（GAS API 一律不快取）
// 更新版本時把 CACHE_NAME 的數字 +1，舊快取會自動清掉
// ═══════════════════════════════════════════════════════
const CACHE_NAME = 'grandol-cache-v31';

const PRECACHE = [
  './',
  './index.html',
  './manifest.json',
  './puppy.png',
  './puppy_icon.png',
  './background.png',
  './background_web.png'
];

self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache =>
      // 個別 add，單張圖失敗不會讓整個安裝失敗
      Promise.all(PRECACHE.map(url => cache.add(url).catch(() => {})))
    )
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  // GAS API（含重新導向的 googleusercontent）永遠走網路、不快取
  if (url.hostname.includes('script.google.com') || url.hostname.includes('googleusercontent.com')) return;

  // network first → 成功就更新快取；失敗用快取；導覽請求最後退回 index.html
  e.respondWith(
    fetch(req).then(res => {
      if (res && (res.ok || res.type === 'opaque')) {
        const clone = res.clone();
        caches.open(CACHE_NAME).then(c => c.put(req, clone)).catch(() => {});
      }
      return res;
    }).catch(() =>
      caches.match(req).then(m => m || (req.mode === 'navigate' ? caches.match('./index.html') : undefined))
    )
  );
});

// 點通知 → 聚焦或打開 APP
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const c of list) { if ('focus' in c) return c.focus(); }
      return clients.openWindow('./');
    })
  );
});
