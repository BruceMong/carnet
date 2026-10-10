# Carnet

Carnet de musculation personnel : une PWA sans framework ni build (une page, un script, un
service worker) pour noter ses séries au téléphone, à la salle, même sans réseau.

- **Données** : une base Supabase, fermée. Quatre fonctions SQL (`carnet_lire`, `carnet_ecrire`,
  `carnet_depuis`, `carnet_contexte`) vérifient une clé secrète dont la base ne garde que
  l'empreinte. La clé publiable inscrite dans `app.js` ne donne accès à rien sans elle.
- **Clé** : posée une fois sur le téléphone par un lien `…/#cle=…` (QR code affiché par
  `carnet-sync --lien` sur le PC), gardée dans le `localStorage`, retirée de l'adresse.
- **Hors ligne** : chaque série est enregistrée sur le téléphone d'abord, envoyée ensuite,
  renvoyée au retour du réseau.
- **Le PC** (`carnet-sync`, dépôt arch-config) récupère les séances pour son suivi et pousse le
  « contexte » : séance du jour selon la rotation push / pull / legs, dernière fois et cible de
  chaque exercice (double progression), conseil d'intensité tiré de la montre.

- **Santé** : les données de la montre et les calculs du panneau Santé du PC — alertes, dernière nuit
  (durée, horaires, phases, score), VFC, FC au repos, Body Battery, stress, SpO2, respiration, semaine en
  cours (pas, séances, minutes intensives), dette et régularité du sommeil, ressenti noté, objectifs, et
  les courbes sur 30 ou 90 jours (poids, sommeil, VFC, FC, Body Battery, stress, pas, coucher).
- **Ce que le panneau Santé permet de noter, au téléphone aussi** (onglet Santé) : ressenti du jour
  (énergie, humeur, peau), note du jour, routine du jour, objectifs sportifs. Chaque geste part daté avec
  la séance du jour ; le PC l'écrit dans journal.md ou objectifs.md comme le panneau, une seule fois, et
  un geste plus ancien que le dernier appliqué pour la même case est ignoré.
- **Fiches d'exercice** : le « i » à côté du nom ouvre la machine en photo (départ, arrivée), son nom
  anglais, les muscles, trois consignes, l'erreur à éviter et le mémo de réglage. Textes dans `fiches.js`
  (clé = nom exact de `sante/sport/exercices.md`), photos de free-exercise-db (domaine public) dans
  `fiches/`, mises en cache à l'installation pour marcher sans réseau.
- **Pendant la séance** : avancement (séries faites sur prévues, durée), séries restantes en pointillé à la
  charge prévue, étiquettes du muscle (avec sa fatigue) et du record. Sous le minuteur de repos, « Il en restait
  combien ? » (0 à 4+, facultatif) : la réserve est écrite `@N` dans seances.md. L'écran clignote à la fin du
  repos. Glisser une série vers la gauche la retire (Annuler), vers la droite la recopie.
- **Cible** : double progression, comme le panneau ; deux crans si tout est tenu avec 3 en réserve ; trois
  séances sans progrès : décharge à −10 % signalée par le PC, puis on remonte.
- **Récupération par muscle** : 8 séries difficiles font une dose, effacée de moitié en 24 h (bras, épaules),
  30 h (pecs, dos) ou 48 h (jambes) ; sous 25 % prêt, sous 50 % presque. Même calcul que le panneau
  (`herdr-sante`, `recuperation`), d'après le modèle d'openGym. Le PC envoie les doses des 7 derniers jours,
  le téléphone y ajoute sa séance du jour.
- **Silhouette** (Progrès) : séries de la semaine par muscle ou récupération, sur les tracés de
  [MuscleMap](https://github.com/melihcolpan/MuscleMap) (licence MIT, reproduite en tête de `corps.js`). Et
  l'équilibre tirer / pousser sur 4 semaines (posture, épaule droite).
- **Progrès** : calendrier des séances, séries par semaine, courbe de chaque exercice (1RM estimé,
  charge), douleur à l'épaule, allure de course.
- Les courbes sont en SVG écrit à la main, sans bibliothèque, pour marcher hors ligne.
- **Photos de suivi** : redimensionnées sur le téléphone (1280 px, JPEG), déposées dans une table de
  transit ; le PC les range dans son dossier puis les efface de la base.

Publié par GitHub Pages depuis `main`.
