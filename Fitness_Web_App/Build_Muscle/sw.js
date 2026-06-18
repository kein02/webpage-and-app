// ====== Service Worker: 增肌助手 PWA ======
// 缓存策略：Cache First（静态资源）+ Network First（数据请求）
// 离线后可正常使用全部功能，数据存储在 IndexedDB 中不受影响

var CACHE_NAME = 'muscle-helper-v2';
var ASSETS = [
  './',
  'index.html',
  'style.css',
  'app.js',
  'data.js',
  'db.js',
  'manifest.json',
  'icon.svg'
];

// 安装：预缓存所有静态资源（容错：单个文件失败不影响整体）
self.addEventListener('install', function(event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function(cache) {
      return Promise.allSettled(
        ASSETS.map(function(url) {
          return cache.add(url).catch(function(err) {
            console.warn('[SW] 缓存失败:', url, err.message);
            return null;
          });
        })
      );
    })
  );
  // 跳过等待，立即激活
  self.skipWaiting();
});

// 激活：清理旧缓存版本
self.addEventListener('activate', function(event) {
  event.waitUntil(
    caches.keys().then(function(cacheNames) {
      return Promise.all(
        cacheNames
          .filter(function(name) { return name !== CACHE_NAME; })
          .map(function(name) { return caches.delete(name); })
      );
    })
  );
  // 接管所有客户端
  self.clients.claim();
});

// 请求拦截：优先返回缓存，离线时回退到缓存
self.addEventListener('fetch', function(event) {
  var request = event.request;

  // API 请求走 Network First
  if (request.url.includes('/api/')) {
    event.respondWith(
      fetch(request)
        .then(function(networkResponse) {
          // 成功请求也缓存
          var clone = networkResponse.clone();
          caches.open(CACHE_NAME).then(function(cache) {
            cache.put(request, clone);
          });
          return networkResponse;
        })
        .catch(function() {
          return caches.match(request);
        })
    );
    return;
  }

  // 静态资源走 Cache First
  event.respondWith(
    caches.match(request).then(function(cached) {
      return cached || fetch(request).then(function(network) {
        // 成功请求也缓存
        var clone = network.clone();
        caches.open(CACHE_NAME).then(function(cache) {
          cache.put(request, clone);
        });
        return network;
      }).catch(function() {
        // 离线 + 无缓存：返回首页
        if (request.mode === 'navigate') {
          return caches.match('./');
        }
      });
    })
  );
});

// 消息处理：推送通知（未来扩展）
self.addEventListener('message', function(event) {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
