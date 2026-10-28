/* Fonctionnement hors connexion du site (pas utilisé dans l'APK, qui embarque ses fichiers). */
var VERSION = '__BUILD__';
var APP_CACHE = 'tayyib-app-' + VERSION;
var DATA_CACHE = 'tayyib-data';
var TILE_CACHE = 'tayyib-tiles';
var MAX_TILES = 400;
var SHELL = [
  './', 'index.html', 'styles.css', 'app.js', 'hours.js', 'i18n.js', 'config.js', 'manifest.webmanifest',
  'vendor/leaflet.js', 'vendor/leaflet.css', 'vendor/leaflet.markercluster.js', 'vendor/MarkerCluster.css',
  'icons/icon-192.png', 'icons/favicon.png'
];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(APP_CACHE).then(function (c) { return c.addAll(SHELL); }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k.indexOf('tayyib-app-') === 0 && k !== APP_CACHE; })
      .map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

function trimTiles() {
  return caches.open(TILE_CACHE).then(function (c) {
    return c.keys().then(function (keys) {
      if (keys.length <= MAX_TILES) return;
      return Promise.all(keys.slice(0, keys.length - MAX_TILES).map(function (k) { return c.delete(k); }));
    });
  });
}

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);

  // Liste des restaurants : réseau d'abord, copie locale si hors connexion
  if (url.origin === location.origin && url.pathname.endsWith('/data/restaurants.json')) {
    e.respondWith(fetch(req).then(function (res) {
      var copy = res.clone();
      caches.open(DATA_CACHE).then(function (c) { c.put(req, copy); });
      return res;
    }).catch(function () { return caches.match(req, { ignoreSearch: true }); }));
    return;
  }

  // Fonds de carte déjà consultés
  if (/tile\.openstreetmap\.org$/.test(url.hostname)) {
    e.respondWith(caches.open(TILE_CACHE).then(function (c) {
      return c.match(req).then(function (hit) {
        if (hit) return hit;
        return fetch(req).then(function (res) {
          if (res.ok || res.type === 'opaque') { c.put(req, res.clone()); trimTiles(); }
          return res;
        });
      });
    }));
    return;
  }

  // Fichiers de l'appli
  if (url.origin === location.origin) {
    e.respondWith(caches.match(req, { ignoreSearch: true }).then(function (hit) {
      var net = fetch(req).then(function (res) {
        if (res.ok) { var copy = res.clone(); caches.open(APP_CACHE).then(function (c) { c.put(req, copy); }); }
        return res;
      }).catch(function () { return hit || caches.match('index.html'); });
      return hit || net;
    }));
  }
});
