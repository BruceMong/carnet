// Hors ligne : l'appli elle-même vient du cache (la salle capte mal), les appels à la base
// passent toujours par le réseau — les séances en attente sont gardées par app.js.
const VERSION = "carnet-v11";
const FICHIERS = ["./", "index.html", "app.js", "fiches.js", "corps.js", "manifest.webmanifest", "icon.svg", "icon-192.png", "icon-512.png"];
// Les photos des fiches d'exercice (~1 Mo), en cache dès l'installation : la salle capte mal.
const IMAGES = [
  "fiches/Butterfly-0.jpg",
  "fiches/Butterfly-1.jpg",
  "fiches/Cable_Crossover-0.jpg",
  "fiches/Cable_Crossover-1.jpg",
  "fiches/Cable_Crunch-0.jpg",
  "fiches/Cable_Crunch-1.jpg",
  "fiches/Cable_Rear_Delt_Fly-0.jpg",
  "fiches/Cable_Rear_Delt_Fly-1.jpg",
  "fiches/Cable_Rope_Overhead_Triceps_Extension-0.jpg",
  "fiches/Cable_Rope_Overhead_Triceps_Extension-1.jpg",
  "fiches/Cable_Seated_Lateral_Raise-0.jpg",
  "fiches/Cable_Seated_Lateral_Raise-1.jpg",
  "fiches/Dumbbell_Bicep_Curl-0.jpg",
  "fiches/Dumbbell_Bicep_Curl-1.jpg",
  "fiches/Face_Pull-0.jpg",
  "fiches/Face_Pull-1.jpg",
  "fiches/Hammer_Curls-0.jpg",
  "fiches/Hammer_Curls-1.jpg",
  "fiches/Incline_Dumbbell_Press-0.jpg",
  "fiches/Incline_Dumbbell_Press-1.jpg",
  "fiches/Leg_Extensions-0.jpg",
  "fiches/Leg_Extensions-1.jpg",
  "fiches/Leg_Press-0.jpg",
  "fiches/Leg_Press-1.jpg",
  "fiches/Machine_Shoulder_Military_Press-0.jpg",
  "fiches/Machine_Shoulder_Military_Press-1.jpg",
  "fiches/Pullups-0.jpg",
  "fiches/Pullups-1.jpg",
  "fiches/Reverse_Machine_Flyes-0.jpg",
  "fiches/Reverse_Machine_Flyes-1.jpg",
  "fiches/Seated_Cable_Rows-0.jpg",
  "fiches/Seated_Cable_Rows-1.jpg",
  "fiches/Seated_Leg_Curl-0.jpg",
  "fiches/Seated_Leg_Curl-1.jpg",
  "fiches/Smith_Machine_Bench_Press-0.jpg",
  "fiches/Smith_Machine_Bench_Press-1.jpg",
  "fiches/Smith_Machine_Incline_Bench_Press-0.jpg",
  "fiches/Smith_Machine_Incline_Bench_Press-1.jpg",
  "fiches/Standing_Calf_Raises-0.jpg",
  "fiches/Standing_Calf_Raises-1.jpg",
  "fiches/Standing_Leg_Curl-0.jpg",
  "fiches/Standing_Leg_Curl-1.jpg",
  "fiches/Thigh_Abductor-0.jpg",
  "fiches/Thigh_Abductor-1.jpg",
  "fiches/Thigh_Adductor-0.jpg",
  "fiches/Thigh_Adductor-1.jpg",
  "fiches/Triceps_Pushdown-0.jpg",
  "fiches/Triceps_Pushdown-1.jpg",
  "fiches/Walking_Treadmill-0.jpg",
  "fiches/Walking_Treadmill-1.jpg",
  "fiches/Wide-Grip_Lat_Pulldown-0.jpg",
  "fiches/Wide-Grip_Lat_Pulldown-1.jpg",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll([...FICHIERS, ...IMAGES])).then(() => self.skipWaiting()));
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
