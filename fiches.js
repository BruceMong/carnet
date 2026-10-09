// Fiches d'exercice : la bulle « i » à côté du nom, pour retrouver la machine et le geste.
// Clé = nom exact de sante/sport/exercices.md. Images : free-exercise-db (domaine public,
// Unlicense), réduites à 360 px dans fiches/<img>-0.jpg (départ) et -1.jpg (arrivée).

export const FICHES = {
  "Développé couché guidé": {
    en: "Smith machine bench press", img: "Smith_Machine_Bench_Press", muscles: "pecs · triceps, épaules avant",
    consignes: ["Barre au-dessus du bas des pecs, pas du cou.", "Omoplates serrées et collées au banc, pieds au sol.", "Descendre jusqu'à frôler la poitrine, coudes à 45° du corps."],
    erreur: "Coudes à 90°, écartés : l'épaule prend tout.",
  },
  "Développé incliné haltères": {
    en: "Incline dumbbell press", img: "Incline_Dumbbell_Press", muscles: "haut des pecs · triceps, épaules avant",
    consignes: ["Banc à 30°, pas plus : au-delà ce sont les épaules qui travaillent.", "Haltères à hauteur de poitrine, avant-bras verticaux.", "Pousser en rapprochant légèrement les haltères en haut."],
    erreur: "Cambrer le dos pour décoller les haltères.",
  },
  "Développé incliné Smith": {
    en: "Smith machine incline press", img: "Smith_Machine_Incline_Bench_Press", muscles: "haut des pecs · triceps, épaules avant",
    consignes: ["Banc à 30°, placé pour que la barre arrive sur le haut des pecs.", "Omoplates serrées, fesses sur le banc.", "Descente lente, deux secondes."],
    erreur: "Barre qui descend vers le cou.",
  },
  "Écarté machine": {
    en: "Pec deck / machine fly", img: "Butterfly", muscles: "pecs",
    consignes: ["Siège réglé pour que les poignées soient à hauteur de poitrine.", "Coudes légèrement fléchis, fixes du début à la fin.", "Serrer une seconde quand les mains se touchent."],
    erreur: "Laisser les bras partir trop en arrière : l'épaule tire.",
  },
  "Écarté poulie": {
    en: "Cable fly", img: "Cable_Crossover", muscles: "pecs",
    consignes: ["Un pas en avant, buste légèrement penché.", "Bras presque tendus, ramener les mains devant la poitrine.", "Revenir lentement, sans laisser la charge tirer."],
    erreur: "Plier les coudes et pousser comme un développé.",
  },
  "Écarté poulie haute": {
    en: "High-to-low cable fly", img: "Cable_Crossover", muscles: "bas et milieu des pecs",
    consignes: ["Poulies en haut, un pas en avant.", "Ramener les mains vers le bas, devant le bassin.", "Coudes légèrement fléchis et fixes."],
    erreur: "Utiliser le poids du corps pour tirer.",
  },
  "Développé militaire": {
    en: "Shoulder press / overhead press", img: "Machine_Shoulder_Military_Press", muscles: "épaules · triceps",
    consignes: ["Assis, dos collé au dossier, abdos serrés.", "Poignées à hauteur du menton au départ.", "Pousser au-dessus de la tête sans verrouiller les coudes."],
    erreur: "Cambrer le bas du dos. Épaule droite : arrêter si ça pince.",
  },
  "Élévations latérales poulie": {
    en: "Cable lateral raise", img: "Cable_Seated_Lateral_Raise", muscles: "épaules (côté)",
    consignes: ["Poulie tout en bas, câble devant le corps.", "Monter le bras sur le côté jusqu'à l'horizontale, pas plus.", "Coude légèrement fléchi, le coude mène le mouvement."],
    erreur: "Hausser les épaules : ce sont les trapèzes qui prennent.",
  },
  "Épaule arrière machine": {
    en: "Reverse pec deck", img: "Reverse_Machine_Flyes", muscles: "arrière des épaules · haut du dos",
    consignes: ["Face au dossier, poitrine collée.", "Poignées à hauteur des épaules, bras presque tendus.", "Ouvrir les bras sur les côtés, sans serrer les omoplates à fond."],
    erreur: "Tirer avec les bras pliés : le dos prend le relais.",
  },
  "Deltoïde arrière poulie": {
    en: "Cable rear delt fly", img: "Cable_Rear_Delt_Fly", muscles: "arrière des épaules",
    consignes: ["Câbles croisés à hauteur des épaules.", "Ouvrir les bras vers l'arrière, presque tendus.", "Petite charge, mouvement contrôlé."],
    erreur: "Charge trop lourde, on tire avec le dos.",
  },
  "Triceps poulie basse": {
    en: "Triceps pushdown", img: "Triceps_Pushdown", muscles: "triceps",
    consignes: ["Coudes collés au corps, ils ne bougent pas.", "Pousser jusqu'à bras tendus, serrer une seconde.", "Remonter jusqu'à avant-bras à l'horizontale."],
    erreur: "Coudes qui avancent : les épaules aident.",
  },
  "Triceps poulie derrière la tête": {
    en: "Overhead cable triceps extension", img: "Cable_Rope_Overhead_Triceps_Extension", muscles: "triceps (chef long)",
    consignes: ["Dos à la poulie, corde derrière la tête.", "Coudes pointés vers l'avant, fixes.", "Tendre les bras vers l'avant et le haut."],
    erreur: "Coudes qui s'écartent sur les côtés.",
  },
  "Écarté inversé machine": {
    en: "Reverse pec deck", img: "Reverse_Machine_Flyes", muscles: "arrière des épaules · haut du dos",
    consignes: ["Face au dossier, poitrine collée.", "Poignées à hauteur des épaules, bras presque tendus.", "Ouvrir les bras sur les côtés, lentement."],
    erreur: "Tirer avec les bras pliés : le dos prend le relais.",
  },
  "Tirage vertical": {
    en: "Lat pulldown", img: "Wide-Grip_Lat_Pulldown", muscles: "dos (grands dorsaux) · biceps",
    consignes: ["Cuisses bloquées sous les boudins, mains un peu plus larges que les épaules.", "Tirer la barre vers le haut de la poitrine, poitrine sortie.", "Penser « coudes vers les poches », pas « mains vers le bas »."],
    erreur: "Tirer derrière la nuque, ou se balancer en arrière.",
  },
  "Tirage horizontal prise serrée": {
    en: "Seated cable row (close grip)", img: "Seated_Cable_Rows", muscles: "milieu du dos · biceps",
    consignes: ["Dos droit, genoux légèrement fléchis.", "Tirer la poignée vers le nombril, coudes le long du corps.", "Serrer les omoplates une seconde."],
    erreur: "Se pencher d'avant en arrière pour tirer.",
  },
  "Tirage horizontal prise moyenne": {
    en: "Seated cable row (medium grip)", img: "Seated_Cable_Rows", muscles: "milieu du dos · arrière des épaules",
    consignes: ["Dos droit, poitrine sortie.", "Tirer vers le bas des pecs, coudes un peu écartés.", "Serrer les omoplates, revenir lentement."],
    erreur: "Arrondir le dos au retour.",
  },
  "Tractions": {
    en: "Pull-up (assisted: assisted pull-up)", img: "Pullups", muscles: "dos (grands dorsaux) · biceps",
    consignes: ["Mains un peu plus larges que les épaules, paumes vers l'avant.", "Abaisser d'abord les épaules, puis tirer le menton au-dessus de la barre.", "Descendre bras presque tendus, sans se laisser tomber."],
    erreur: "Se balancer. Épaule droite : commencer à la machine assistée.",
  },
  "Face pull": {
    en: "Face pull", img: "Face_Pull", muscles: "arrière des épaules · coiffe des rotateurs",
    consignes: ["Corde à hauteur des yeux.", "Tirer vers le visage en écartant les mains de chaque côté de la tête.", "Finir coudes hauts, pouces vers l'arrière."],
    erreur: "Charge trop lourde : c'est un exercice de santé de l'épaule.",
  },
  "Curl biceps": {
    en: "Biceps curl", img: "Dumbbell_Bicep_Curl", muscles: "biceps",
    consignes: ["Coudes collés au corps.", "Monter en tournant la paume vers le haut.", "Descendre lentement jusqu'à bras tendus."],
    erreur: "Balancer le buste pour monter.",
  },
  "Curl marteau": {
    en: "Hammer curl", img: "Hammer_Curls", muscles: "biceps · avant-bras",
    consignes: ["Paumes face à face, comme un marteau.", "Coudes fixes le long du corps.", "Descente lente."],
    erreur: "Coudes qui avancent.",
  },
  "Leg curl": {
    en: "Leg curl", img: "Seated_Leg_Curl", muscles: "ischios",
    consignes: ["Genou aligné avec l'axe de la machine.", "Boudin juste au-dessus des chevilles.", "Plier au maximum, serrer, remonter lentement."],
    erreur: "Décoller les hanches pour finir le mouvement.",
  },
  "Leg curl unijambe": {
    en: "Single-leg curl", img: "Standing_Leg_Curl", muscles: "ischios",
    consignes: ["Genou aligné avec l'axe de la machine.", "Une jambe à la fois, même charge des deux côtés.", "Contrôler la descente."],
    erreur: "Tourner le bassin pour aider.",
  },
  "Leg extension": {
    en: "Leg extension", img: "Leg_Extensions", muscles: "quadriceps",
    consignes: ["Dossier réglé pour que le genou soit dans l'axe de la machine.", "Boudin sur le bas du tibia.", "Tendre les jambes, tenir une seconde, redescendre lentement."],
    erreur: "Lancer la charge et la laisser retomber.",
  },
  "Presse à cuisses": {
    en: "Leg press", img: "Leg_Press", muscles: "quadriceps · fessiers",
    consignes: ["Pieds largeur d'épaules au milieu de la plateforme.", "Descendre jusqu'à genoux à 90°, bas du dos collé.", "Pousser sans verrouiller les genoux."],
    erreur: "Descendre si bas que le bassin décolle.",
  },
  "Adducteurs machine": {
    en: "Hip adduction machine", img: "Thigh_Adductor", muscles: "adducteurs (intérieur des cuisses)",
    consignes: ["Dos collé au dossier.", "Serrer les jambes, tenir une seconde.", "Rouvrir lentement."],
    erreur: "Laisser la charge claquer au retour.",
  },
  "Abducteurs machine": {
    en: "Hip abduction machine", img: "Thigh_Abductor", muscles: "fessiers (moyen fessier)",
    consignes: ["Dos collé, ou buste légèrement penché en avant pour plus de fessiers.", "Écarter les jambes, tenir une seconde.", "Refermer lentement."],
    erreur: "Mouvement trop rapide, amplitude réduite.",
  },
  "Mollets": {
    en: "Calf raise", img: "Standing_Calf_Raises", muscles: "mollets",
    consignes: ["Avant des pieds sur la marche, talons dans le vide.", "Descendre les talons au maximum, étirement.", "Monter sur la pointe, tenir une seconde."],
    erreur: "Rebondir en bas sans s'arrêter.",
  },
  "Crunch poulie": {
    en: "Cable crunch", img: "Cable_Crunch", muscles: "abdos",
    consignes: ["À genoux, corde de chaque côté de la tête.", "Enrouler le dos vers le bas, coudes vers les genoux.", "Les hanches ne bougent pas."],
    erreur: "S'asseoir sur les talons : ce sont les bras qui tirent.",
  },
  "Marche en pente": {
    en: "Incline treadmill walk", img: "Walking_Treadmill", muscles: "cardio · fessiers, mollets",
    consignes: ["Inclinaison 8, vitesse 4 pour commencer.", "Lâcher les barres : buste droit.", "Rythme où l'on peut encore parler."],
    erreur: "Se tenir aux barres, ce qui annule la pente.",
  },
};
