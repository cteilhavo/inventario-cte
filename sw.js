/*
 * Inventário CTE — service worker
 * ------------------------------------------------------------
 * Objetivo: o "casco" da aplicação (HTML, JS, ícones) abre mesmo com Wi-Fi fraco
 * ou sem rede. Os dados continuam a vir sempre do Apps Script (POST cross-origin),
 * que este worker NUNCA interceta.
 *
 * Ao publicar uma alteração aos ficheiros em site/, subir CACHE_VERSAO (ex.: v1 -> v2).
 * Sem isso, o browser pode continuar a servir a versão anterior da cache.
 */
const CACHE_VERSAO = 'cte-inventario-v1';
const CACHE = CACHE_VERSAO;
const PRECACHE = [
  './',
  './index.html',
  './app.js',
  './config.js',
  './qrlib.js',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png',
  './apple-touch-icon.png'
];
const TEMPO_REDE_MS = 3500;

self.addEventListener('install', function (evento) {
  evento.waitUntil(
    caches.open(CACHE)
      .then(function (c) { return c.addAll(PRECACHE); })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (evento) {
  evento.waitUntil(
    caches.keys()
      .then(function (chaves) {
        return Promise.all(chaves.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
      })
      .then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('message', function (evento) {
  if (evento.data === 'SKIP_WAITING') self.skipWaiting();
});

// Rede primeiro, com limite de tempo; se falhar ou demorar, usa a cópia guardada.
function redePrimeiro(pedido, limitarMs, aoFalhar) {
  return new Promise(function (resolver) {
    let terminado = false;
    const temporizador = setTimeout(function () {
      if (terminado) return;
      terminado = true;
      caches.match(pedido).then(function (cache) { resolver(cache || aoFalhar()); });
    }, limitarMs);

    fetch(pedido).then(function (resposta) {
      if (terminado) return;
      terminado = true;
      clearTimeout(temporizador);
      if (resposta && resposta.ok) {
        const copia = resposta.clone();
        caches.open(CACHE).then(function (c) { c.put(pedido, copia); });
      }
      resolver(resposta);
    }).catch(function () {
      if (terminado) return;
      terminado = true;
      clearTimeout(temporizador);
      caches.match(pedido).then(function (cache) { resolver(cache || aoFalhar()); });
    });
  });
}

self.addEventListener('fetch', function (evento) {
  const pedido = evento.request;

  // Só GET e só same-origin. O Apps Script é outro domínio e exige POST: não se toca.
  if (pedido.method !== 'GET') return;
  const url = new URL(pedido.url);
  if (url.origin !== self.location.origin) return;

  if (pedido.mode === 'navigate') {
    evento.respondWith(
      redePrimeiro(pedido, TEMPO_REDE_MS, function () {
        return caches.match('./index.html').then(function (c) { return c || Response.error(); });
      })
    );
    return;
  }

  evento.respondWith(
    redePrimeiro(pedido, TEMPO_REDE_MS, function () { return Response.error(); })
  );
});
