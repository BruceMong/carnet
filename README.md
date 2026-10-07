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
- **Progrès** : calendrier des séances, séries par semaine, courbe de chaque exercice (1RM estimé,
  charge), douleur à l'épaule, allure de course.
- Les courbes sont en SVG écrit à la main, sans bibliothèque, pour marcher hors ligne.
- **Photos de suivi** : redimensionnées sur le téléphone (1280 px, JPEG), déposées dans une table de
  transit ; le PC les range dans son dossier puis les efface de la base.

Publié par GitHub Pages depuis `main`.
