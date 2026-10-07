// Hors ligne : l'appli elle-même vient du cache (la salle capte mal), les appels à la base
// passent toujours par le réseau — les séances en attente sont gardées par app.js.
const VERSION = "carnet-v8";
const FICHIERS = ["./", "index.html", "app.js", "manifest.webmanifest", "icon.svg", "icon-192.png", "icon-512.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(FICHIERS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys()
    .then((ks) => Promise.all(ks.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// Réseau d'abord pour l'appli (une nouvelle version arrive dès qu'on capte), cache sinon.
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  e.respondWith(
    fetch(e.request)
      .then((r) => { const copie = r.clone(); caches.open(VERSION).then((c) => c.put(e.request, copie)); return r; })
      .catch(() => caches.match(e.request, { ignoreSearch: true }).then((r) => r || caches.match("index.html")))
  );
});
