// Carnet de musculation — saisie des séances au téléphone.
//
// Les données vivent dans une base Supabase, derrière quatre fonctions qui vérifient une clé
// secrète (posée une fois par le lien « #cle=… » que montre `carnet-sync --lien` sur le PC).
// Le PC y pousse un « contexte » (séance du jour, programme, dernière fois de chaque exercice,
// conseil d'intensité tiré de la montre) et récupère les séances pour les écrire dans
// sante/sport/seances.md.
//
// Hors ligne d'abord : chaque série est gardée sur le téléphone avant d'être envoyée, et renvoyée
// dès que le réseau revient. Une séance = un document par jour, réécrit en entier.

import { FICHES } from "./fiches.js";
import { CORPS } from "./corps.js";

const URL_API = "https://vesdcipjplvgdwfsvefq.supabase.co/rest/v1/rpc/";
const PUBLIQUE = "sb_publishable_6sYHfOdCG9m-xAkfm8Zcwg_7F4ZKu2c";
const TYPES = ["push", "pull", "legs", "autre"];
const JOURS = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"];

const $ = (s) => document.querySelector(s);
const lire = (k, defaut = null) => { try { return JSON.parse(localStorage.getItem(k)) ?? defaut; } catch { return defaut; } };
const ecrire = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };
const aujourdhui = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); };
const kg = (c) => (c === 0 ? "pdc" : c == null ? "?" : String(c).replace(".", ","));
const jj = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

// ───────────────────────────────────────── la clé

let cle = lire("carnet:cle");
if (location.hash.startsWith("#cle=")) {
  cle = decodeURIComponent(location.hash.slice(5));
  ecrire("carnet:cle", cle);
  history.replaceState(null, "", location.pathname);   // la clé ne reste pas dans l'adresse
}

async function api(fonction, params = {}) {
  const r = await fetch(URL_API + fonction, {
    method: "POST",
    headers: { apikey: PUBLIQUE, "Content-Type": "application/json" },
    body: JSON.stringify({ p_cle: cle, ...params }),
  });
  const texte = await r.text();
  const corps = texte ? JSON.parse(texte) : null;
  if (!r.ok) throw Object.assign(new Error(corps?.message || r.statusText), { code: corps?.code });
  return corps;
}

// ───────────────────────────────────────── l'état

let ctx = lire("carnet:ctx");                  // contexte poussé par le PC
let distantes = lire("carnet:seances", []);    // séances des 90 derniers jours, vues du serveur
const jour = aujourdhui();
let doc = lire(`carnet:seance:${jour}`)?.doc || null;
let ouvert = null;                            // exercice dont la saisie est dépliée
let saisie = {};                              // nom → {edits: {ligne: {c, r}}, extra} : lignes prévues réglées à la main
let memoEdite = null;                         // exercice dont le mémo est en cours de modification
let choisie = null;                           // [nom, ligne] sélectionnée (sinon : la prochaine série)
let onglet = "seance";                        // « seance », « sante » ou « progres »
let exoGraphe = lire("carnet:exo-graphe");    // exercice tracé dans Progrès

function toutesSeances() {
  // Les séances connues, la plus récente d'abord : serveur, plus celles du téléphone pas encore envoyées.
  const parJour = {};
  for (const s of distantes) if (s?.jour) parJour[s.jour] = s;
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k?.startsWith("carnet:seance:")) { const x = lire(k); if (x?.doc) parJour[x.doc.jour] = x.doc; }
  }
  return Object.values(parJour).sort((a, b) => b.jour.localeCompare(a.jour));
}

function derniereFois(nom) {
  // La dernière fois avant aujourd'hui : séances du téléphone, ou historique calculé par le PC
  // (qui connaît aussi les séances racontées à Claude) — la plus récente des deux.
  let mieux = null;
  for (const s of toutesSeances()) {
    if (s.jour >= jour) continue;
    const e = s.exos?.find((x) => x.nom === nom && x.series?.length);
    if (e) { mieux = { jour: s.jour, series: e.series.map((x) => [x.c, x.r]), rir: e.series.map((x) => x.e ?? null), cran: e.cran }; break; }
  }
  const h = ctx?.historique?.[nom];
  if (h && h.jour < jour && (!mieux || h.jour > mieux.jour)) mieux = { jour: h.jour, series: h.series, rir: h.rir || null, cran: null };
  return mieux;
}

// Le mémo d'un exercice : son réglage permanent (cran, siège, prise…), pas une donnée de séance.
// Celui du téléphone d'abord (pas encore repassé par le PC), sinon la colonne Réglage d'exercices.md.
function memo(nom) {
  const local = lire(`carnet:memo:${nom}`);
  if (local != null) return local;
  return ctx?.exercices?.find((x) => x.nom === nom)?.reglage || "";
}

function cible(der, nom) {
  // Double progression, même règle que le panneau Santé (herdr-sante, cible) : charge gardée tant
  // que le schéma n'est pas tenu à la charge la plus haute, puis charge suivante ; deux crans si
  // tout a été tenu avec 3 répétitions en réserve. Trois séances sans progrès : décharge à −10 %,
  // signalée par le PC (il voit tout l'historique), tant qu'aucune séance plus récente ne l'a suivie.
  const series = der.series;
  const { series: n = 4, reps = 8 } = ctx?.schema || {};
  const charges = series.map((s) => s[0]).filter((c) => c != null);
  if (!charges.length) return null;
  const haut = Math.max(...charges);
  const aHaut = series.filter((s) => s[0] === haut).map((s) => s[1]);
  if (haut === 0) return { texte: `vise ${Math.max(...aHaut) + 1} à la première série`, c: 0, r: Math.max(...aHaut) + 1 };
  const h = ctx?.historique?.[nom];
  if (h?.stagne && h.decharge && h.jour === der.jour)
    return { texte: `rien de gagné en 3 séances → décharge : ${kg(h.decharge)} kg, ${n}×${reps} sans forcer, puis on remonte`,
             c: h.decharge, r: reps, decharge: true };
  if (aHaut.length >= n && Math.min(...aHaut) >= reps) {
    const notes = series.map((x, i) => [x[0], der.rir?.[i]]).filter(([c, e]) => c === haut && e != null).map((x) => x[1]);
    if (notes.length >= n && Math.min(...notes) >= 3)
      return { texte: `${n}×${reps} tenu, 3 en réserve partout → deux crans (+5 kg), vise ${n}×6-7`, c: haut, r: 6, monte: true };
    return { texte: `${n}×${reps} tenu → charge suivante, vise ${n}×6-7`, c: haut, r: 6, monte: true };
  }
  if (aHaut.length < n) return { texte: `reste à ${kg(haut)} : vise ${n} séries`, c: haut, r: reps };
  const vise = [...aHaut].sort((a, b) => b - a).slice(0, n);
  vise[vise.length - 1] = Math.min(reps, vise[vise.length - 1] + 1);
  return { texte: `reste à ${kg(haut)} : vise ${vise.join(", ")}`, c: haut, r: vise[vise.length - 1] };
}

// ───────────────────────────────────────── les lignes de séries

// Chaque exercice se lit en lignes, comme dans openGym : les séries faites, puis les séries prévues,
// pré-remplies. Une ligne prévue reprend la ligne d'avant (la dernière série faite, ou la cible),
// sauf si on l'a réglée : régler la charge d'une ligne la fait suivre aux suivantes. Une ligne faite
// se corrige directement (charge, répétitions, réserve) au lieu d'être retirée puis refaite.
function lignesDe(nom) {
  const e = seanceDuJour().exos.find((x) => x.nom === nom);
  const faites = e?.series || [];
  const der = derniereFois(nom), ci = der ? cible(der, nom) : null;
  const n = ctx?.schema?.series || 4;
  const st = (saisie[nom] ||= { edits: {}, extra: 0 });
  let prec = faites.length ? { c: faites[faites.length - 1].c, r: faites[faites.length - 1].r }
    : { c: ci?.c ?? der?.series?.[0]?.[0] ?? 20, r: ci?.r ?? ctx?.schema?.reps ?? 8 };
  const L = faites.map((x, k) => ({ k, c: x.c, r: x.r, e: x.e, fait: true }));
  for (let j = 0; j < Math.max(0, n - faites.length) + st.extra; j++) {
    const k = faites.length + j;
    prec = { ...prec, ...(st.edits[k] || {}) };
    L.push({ k, c: prec.c, r: prec.r, fait: false });
  }
  const k0 = faites.length;   // la prochaine série
  const ks = choisie?.[0] === nom && L.some((l) => l.k === choisie[1]) ? choisie[1] : (L.some((l) => l.k === k0) ? k0 : null);
  return { e, L, k0, ks, der, ci, n, st };
}

// Une série faite retirée ou ajoutée décale les lignes prévues qui suivent, et leurs réglages.
function decaler(nom, depuis, d) {
  const st = saisie[nom];
  if (!st) return;
  st.edits = Object.fromEntries(Object.entries(st.edits).map(([k, v]) => [Number(k) > depuis ? Number(k) + d : Number(k), v]));
}

function retirerSerie(nom, i) {
  const s = seanceDuJour(), e = s.exos.find((z) => z.nom === nom);
  if (!e?.series?.[i]) return;
  const [serie] = e.series.splice(i, 1);
  const ordre = s.exos.indexOf(e);
  if (!e.series.length) s.exos = s.exos.filter((z) => z !== e);
  decaler(nom, i, -1);
  annulation = { nom, i, serie, ordre };
  toast(`Série ${kg(serie.c)}×${serie.r} retirée`, true);
  choisie = null; sauver();
}

// ───────────────────────────────────────── récupération, volume, équilibre

// Même calcul que le panneau (herdr-sante, recuperation) : 8 séries difficiles font une dose, une
// série avec beaucoup de répétitions en réserve compte moins, la dose s'efface de moitié en 24 à 48 h
// selon le muscle. Le PC envoie les doses des 7 derniers jours ; les séances du téléphone plus
// récentes que sa dernière synchro remplacent les siennes, pour que la séance du jour compte déjà.
const poidsReserve = (e) => (e == null || e <= 2 ? 1 : Math.max(0.3, 1 - 0.7 * (e - 2) / 4));
const groupeDe = (nom) => ctx?.exercices?.find((x) => x.nom === nom)?.groupe;
const seancesRecentes = () => toutesSeances().filter((s) => s.jour >= (ctx?.genere?.slice(0, 10) || "")
  && s.exos?.some((e) => e.series?.length));

function doses() {
  const out = { ...(ctx?.doses || {}) };
  for (const s of seancesRecentes()) {
    for (const k of Object.keys(out)) if (k.startsWith(s.jour)) delete out[k];
    const debut = s.exos.flatMap((e) => (e.series || []).map((x) => x.t)).filter(Boolean).sort()[0];
    const k = `${s.jour}T${(debut || "18:00").slice(0, 5)}`;
    for (const e of s.exos) {
      const g = groupeDe(e.nom);
      if (!g || !ctx?.demi_vie?.[g] || !e.series?.length) continue;
      (out[k] ||= {})[g] = (out[k][g] || 0) + e.series.reduce((a, x) => a + poidsReserve(x.e), 0) / 8;
    }
  }
  return out;
}

function recup() {
  // groupe → fatigue de 0 à 1 ; sous 0,25 prêt, sous 0,5 presque, au-delà fatigué.
  const hl = ctx?.demi_vie || {}, maintenant = Date.now(), reste = {};
  for (const [k, gs] of Object.entries(doses())) {
    const age = (maintenant - new Date(k).getTime()) / 36e5;   // « AAAA-MM-JJTHH:MM » : heure locale
    if (age > 7 * 24) continue;
    for (const [g, v] of Object.entries(gs)) if (hl[g]) reste[g] = (reste[g] || 0) + v * 0.5 ** (Math.max(0, age) / hl[g]);
  }
  return Object.fromEntries(Object.entries(reste).map(([g, v]) => [g, 1 - Math.exp(-v)]));
}
const etatRecup = (f) => (f >= 0.5 ? "rouge" : f >= 0.25 ? "jaune" : "vert");

function seriesGroupes() {
  // jour → {groupe: séries} sur 4 semaines : celles du PC, plus les séances récentes du téléphone.
  const out = { ...(ctx?.series_groupes || {}) };
  for (const s of seancesRecentes()) {
    const j = (out[s.jour] = {});
    for (const e of s.exos) {
      const g = groupeDe(e.nom);
      if (g && g !== "cardio" && e.series?.length) j[g] = (j[g] || 0) + e.series.length;
    }
  }
  return out;
}

function volume(depuis) {
  const v = {};
  for (const [j, gs] of Object.entries(seriesGroupes())) if (j >= depuis) for (const [g, n] of Object.entries(gs)) v[g] = (v[g] || 0) + n;
  return v;
}

function prochaine() {
  // La séance du jour selon la rotation, reprise après la dernière séance connue.
  const rot = ctx?.rotation || ["push", "pull", "legs", "repos"];
  const der = toutesSeances().find((s) => s.jour < jour && rot.includes(s.type) && s.exos?.some((e) => e.series?.length));
  let d = der ? { jour: der.jour, type: der.type } : null;
  if (ctx?.derniere && ctx.derniere.jour < jour && (!d || ctx.derniere.jour > d.jour)) d = ctx.derniere;
  if (!d) return rot.find((x) => x !== "repos") || "push";
  const i = rot.indexOf(d.type);
  let n = rot[(i + 1) % rot.length];
  const ecart = (new Date(jour) - new Date(d.jour)) / 864e5;
  if (n === "repos" && ecart >= 2) n = rot[(i + 2) % rot.length];
  return n;
}

// ───────────────────────────────────────── enregistrement

let envoi = null;
function sauver() {
  doc.maj = new Date().toISOString();
  ecrire(`carnet:seance:${jour}`, { doc, sale: true });
  clearTimeout(envoi);
  envoi = setTimeout(synchroniser, 800);
  etat("attente", "à envoyer");
}

let enCours = false, relancer = false;
async function synchroniser() {
  if (!cle) return;
  if (enCours) { relancer = true; return; }   // un envoi à la fois ; celui-ci repartira à la fin
  enCours = true;
  let reste = 0, change = false;
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (!k?.startsWith("carnet:seance:")) continue;
    const x = lire(k);
    if (!x?.sale) continue;
    try {
      await api("carnet_ecrire", { p_jour: x.doc.jour, p_doc: x.doc });
      const actuel = lire(k);   // une série ajoutée pendant l'envoi garde la séance « à envoyer »
      if (actuel?.doc?.maj === x.doc.maj) ecrire(k, { doc: x.doc, sale: false });
      else change = true;   // modifiée pendant l'envoi : on renvoie tout de suite, pas dans 30 s
    } catch (e) {
      reste++;
      console.warn("envoi impossible", x.doc.jour, e.message);
      if (e.code === "28000") { etat("erreur", "clé refusée"); enCours = false; return; }
    }
  }
  enCours = false;
  if (change || relancer) { relancer = false; return synchroniser(); }
  if (lire("carnet:photos", []).length) envoyerPhotos();
  if (reste) { etat("attente", navigator.onLine ? "réessai…" : "hors ligne · gardé ici"); setTimeout(synchroniser, 30000); }
  else etat("ok", "enregistré ✓");
}

async function charger() {
  try {
    const r = await api("carnet_lire");
    if (r?.contexte) { ctx = r.contexte; ecrire("carnet:ctx", ctx); }
    distantes = r?.seances || [];
    ecrire("carnet:seances", distantes);
    const serveur = distantes.find((s) => s.jour === jour);
    const local = lire(`carnet:seance:${jour}`);
    // La séance du jour saisie ailleurs (autre téléphone, navigateur) et rien d'en attente ici.
    if (serveur && !local?.sale && (!doc || (serveur.maj || "") > (doc.maj || ""))) {
      doc = serveur;
      ecrire(`carnet:seance:${jour}`, { doc, sale: false });
    }
    etat("ok", ctx?.genere ? `PC vu ${ctx.genere.slice(8, 10)}/${ctx.genere.slice(5, 7)} ${ctx.genere.slice(11, 16)}` : "");
  } catch (e) {
    console.warn("lecture impossible", e.message);
    if (e.code === "28000") { cle = null; localStorage.removeItem("carnet:cle"); }
    etat("attente", "hors ligne");
  }
  synchroniser();
  dessiner();
}

function etat(classe, texte) {
  const e = $("#etat");
  e.className = `etat ${classe}`;
  e.textContent = texte;
}

// ───────────────────────────────────────── l'écran

function seanceDuJour() {
  if (!doc) doc = { jour, type: prochaine(), exos: [], note: "" };
  if (doc.type === "repos") doc.type = "autre";
  return doc;
}

function exosAffiches(d) {
  const prevus = (ctx?.programme?.[d.type] || []).slice();
  for (const e of d.exos) if (!prevus.includes(e.nom)) prevus.push(e.nom);
  return prevus;
}

function dessiner() {
  const app = $("#app");
  const d = new Date();
  $("#titre").textContent = `${JOURS[d.getDay()]} ${jj(jour)}`;
  if (!cle) {
    app.innerHTML = `<div class="accueil"><p>Pas encore de clé.</p><p>Sur le PC : <b>carnet-sync --lien</b>,
      puis scanne le QR code avec ce téléphone.</p></div>`;
    return;
  }
  document.querySelectorAll("[data-onglet]").forEach((b) => b.classList.toggle("choisi", b.dataset.onglet === onglet));
  if (onglet === "progres") { app.innerHTML = progres(); return; }
  if (onglet === "sante") { app.innerHTML = sante(); return; }
  const s = seanceDuJour();
  const p = prochaine();
  const c = ctx?.conseil;
  let h = "";
  if (c && ctx.aujourdhui === jour) {
    h += `<div class="carte conseil ${esc(c.niveau)}"><b>${esc(c.titre)}</b>${esc(c.texte)}`
      + (c.fatigue?.length ? `<div class="sous">↓ ${esc(c.fatigue.join(" · "))}</div>` : "")
      + (c.forme?.length ? `<div class="sous">↑ ${esc(c.forme.join(" · "))}</div>` : "") + `</div>`;
  } else if (p === "repos") {
    h += `<div class="carte conseil"><b>Repos selon la rotation</b>Posture et étirements sur le tapis.</div>`;
  }
  h += `<div class="types">${TYPES.map((t) => `<button data-type="${t}" class="${t === s.type ? "choisi" : ""}">${t}${t === p ? " ·" : ""}</button>`).join("")}</div>`;
  const nSeries = ctx?.schema?.series || 4;
  const faitesTot = s.exos.reduce((a, e) => a + (e.series?.length || 0), 0);
  if (faitesTot) {
    // Avancement de la séance : séries faites sur séries prévues, et durée depuis la première.
    const prevues = Math.max(faitesTot, exosAffiches(s).length * nSeries);
    const ts = s.exos.flatMap((e) => (e.series || []).map((x) => x.t)).filter(Boolean).sort();
    let duree = "";
    if (ts.length) {
      const enMin = (t) => { const [a, b] = t.split(":").map(Number); return a * 60 + b; };
      const n = new Date(), maint = n.getHours() * 60 + n.getMinutes();
      const fin = jour === aujourdhui() && maint - enMin(ts[ts.length - 1]) < 20 ? maint : enMin(ts[ts.length - 1]);
      duree = `${Math.max(0, fin - enMin(ts[0]))} min`;
    }
    h += `<div class="avance"><div class="j-haut"><span><b>${faitesTot}</b> / ${prevues} séries</span><span>${duree}</span></div>
      <div class="j-barre"><i style="width:${Math.min(100, Math.round(100 * faitesTot / prevues))}%;background:var(--bleu)"></i></div></div>`;
  }
  const rc = recup();
  if (Object.keys(rc).length) {
    const pasPrets = Object.entries(rc).filter(([, f]) => f >= 0.25).sort((a, b) => b[1] - a[1]);
    h += `<div class="sous recup">Récupération : ${pasPrets.length ? pasPrets.map(([g, f]) => `<span class="${etatRecup(f)}">${esc(g)} ${Math.round(f * 100)} %</span>`).join(" · ")
      + " · le reste est récupéré" : "muscles récupérés"}</div>`;
  }
  if (ctx?.jambes_depuis != null && s.type !== "legs" && ctx.jambes_depuis > 5)
    h += `<div class="sous alerte">Jambes : dernière séance il y a ${ctx.jambes_depuis} jours.</div>`;

  for (const nom of exosAffiches(s)) {
    const e = s.exos.find((x) => x.nom === nom);
    const faites = e?.series || [];
    const der = derniereFois(nom);
    const ci = der ? cible(der, nom) : null;
    const n = ctx?.schema?.series || 4;
    const { L, k0, ks } = lignesDe(nom);
    h += `<div class="carte exo ${ouvert === nom ? "ouvert" : ""} ${faites.length >= n ? "fait" : ""}" data-exo="${esc(nom)}">
      <h3 data-ouvrir="${esc(nom)}"><span class="nom">${esc(nom)}${FICHES[nom] ? `<button class="info" data-fiche="${esc(nom)}" aria-label="Fiche de l'exercice">i</button>` : ""}</span><span class="n">${faites.length}/${n}</span></h3>`;
    if (der) h += `<div class="sous">${jj(der.jour)} : ${esc(formatSeries(der.series))}</div>`;
    else h += `<div class="sous">pas encore d'historique</div>`;
    const g = groupeDe(nom), rec = ctx?.records?.[nom];
    const tg = [];
    if (g) tg.push(`<span class="tag ${rc[g] != null ? etatRecup(rc[g]) : ""}">${esc(g)}${rc[g] >= 0.25 ? ` · ${Math.round(rc[g] * 100)} %` : ""}</span>`);
    if (rec?.charge) tg.push(`<span class="tag">record ${kg(rec.charge)} kg</span>`);
    else if (rec?.reps) tg.push(`<span class="tag">record ${rec.reps} reps</span>`);
    if (tg.length) h += `<div class="tags">${tg.join("")}</div>`;
    const mm = memo(nom);
    if (memoEdite === nom)
      h += `<div class="ligne2"><input id="memo-champ" value="${esc(mm)}" placeholder="cran 15 · siège 3 · prise large…"><button data-memo-ok>OK</button></div>`;
    else if (mm || ouvert === nom)
      h += `<div class="memo" data-memo="${esc(nom)}">📌 ${mm ? esc(mm) : "<i>ajouter un mémo de réglage</i>"}</div>`;
    if (ci) h += `<div class="cible ${ci.monte ? "monte" : ""} ${ci.decharge ? "decharge" : ""}">→ ${esc(ci.texte)}</div>`;
    if (e?.note && ouvert !== nom) h += `<div class="remarque">✎ ${esc(e.note)}</div>`;
    const fmtL = (l) => `${l.c === 0 ? "pdc" : `${kg(l.c)} kg`} × ${l.r}`;
    if (ouvert !== nom) {
      // Carte fermée : le résumé en puces, faites puis prévues (pointillé). Toucher une puce ouvre sa ligne.
      if (L.length) h += `<div class="series">${L.map((l) => l.fait
        ? `<span class="serie" data-ligne="${l.k}" data-nom="${esc(nom)}">${kg(l.c)}×${l.r}${l.e != null ? `<small>@${l.e}</small>` : ""}</span>`
        : `<span class="prevue" data-ligne="${l.k}" data-nom="${esc(nom)}">${kg(l.c)}×${l.r}</span>`).join("")}</div>`;
    } else {
      // Carte ouverte : une ligne par série. Le rond de la prochaine série la valide ; toucher une ligne
      // la sélectionne pour la régler (prévue) ou la corriger (faite) avec les boutons du dessous.
      // Glisser une série faite vers la gauche la retire (Annuler), vers la droite la recopie.
      h += `<div class="lignes-series">${L.map((l) => `<div class="ls ${l.fait ? "fait" : l.k === k0 ? "prochaine" : "prevue"} ${l.k === ks ? "sel" : ""}" data-ligne="${l.k}" data-nom="${esc(nom)}">
          <span class="ls-n">${l.k + 1}</span><span class="ls-v">${fmtL(l)}</span><span class="ls-e">${l.e != null ? `${l.e === 4 ? "4+" : l.e} en réserve` : ""}</span>
          ${l.fait ? `<span class="ls-ok fait">✓</span>` : l.k === k0 ? `<button class="ls-ok" data-cocher aria-label="Valider la série ${l.k + 1}"></button>` : `<span class="ls-ok vide"></span>`}</div>`).join("")}</div>`;
      const ls = L.find((l) => l.k === ks);
      h += `<div class="saisie">`;
      if (ls) {
        h += `<div class="sous sel-titre">${ls.fait ? `Série ${ks + 1}, faite : corriger` : ks === k0 ? `Série ${ks + 1}` : `Série ${ks + 1}, prévue`}</div>
        <div class="rangee"><label>kg</label><button data-pas="-2.5">−2,5</button><button data-pas="-1">−1</button>
          <span class="val">${kg(ls.c)}</span><button data-pas="1">+1</button><button data-pas="2.5">+2,5</button></div>
        <div class="rangee"><label>reps</label><button data-reps="-1">−</button><span class="val">${ls.r}</span><button data-reps="1">+</button></div>`;
        if (ls.fait)
          h += `<div class="reserve"><span class="sous">Il en restait combien ?</span>${[0, 1, 2, 3, 4].map((k) => `<button data-reserve="${k}" class="${ls.e === k ? "choisi" : ""}">${k === 4 ? "4+" : k}</button>`).join("")}</div>
            <div class="deux"><button class="gros danger" data-retirer>Retirer</button><button class="gros" data-deselect>OK</button></div>`;
        else if (ks === k0) h += `<button class="gros" data-valider>Série ${ks + 1} ✓</button>`;
        else h += `<button class="gros secondaire" data-deselect>OK</button>`;
      }
      h += `<input class="note-exo" data-note-exo value="${esc(e?.note || "")}" placeholder="Note sur l'exercice (sensations, réglage, douleur…)">
        <button class="lien" data-plus-serie>+ une série</button></div>`;
    }
    h += `</div>`;
  }
  h += `<button class="lien" id="ajouter">+ Ajouter un exercice</button>`;
  // Épaule droite : la douleur du jour règle la réintroduction des exercices en pause.
  const dl = s.douleur;
  h += `<div class="carte"><b>Épaule droite</b> <span class="sous">douleur aujourd'hui, de 0 à 10</span>
    <div class="echelle">${Array.from({ length: 11 }, (_, i) => `<button data-douleur="${i}" class="${dl === i ? "choisi" : ""}"
      style="${dl === i ? `background:${i <= 1 ? "var(--vert)" : i <= 3 ? "var(--jaune)" : "var(--rouge)"}` : ""}">${i}</button>`).join("")}</div></div>`;
  const pes = ctx?.pesees?.length ? ctx.pesees[ctx.pesees.length - 1] : null;
  const vieille = !pes || (new Date(jour) - new Date(pes[0])) / 864e5 > 7;
  h += `<div class="carte"><b>Poids</b> <span class="sous">${pes ? `dernier : ${String(pes[1]).replace(".", ",")} kg le ${jj(pes[0])}` : "aucune pesée"}
      ${vieille && !s.poids ? ' · <span class="alerte">pesée de la semaine</span>' : ""}</span>
    <div class="ligne2"><input id="poids" inputmode="decimal" placeholder="kg, le matin à jeun" value="${s.poids ? String(s.poids).replace(".", ",") : ""}">
      <button data-poids-ok>OK</button></div></div>`;
  const nPhotos = lire("carnet:photos", []).length;
  const dp = ctx?.photo_derniere;
  const aRefaire = !dp || (new Date(jour) - new Date(dp)) / 864e5 >= 28;
  h += `<div class="carte"><b>Photos de suivi</b> <span class="sous">${dp ? `dernières le ${jj(dp)}` : "aucune encore"}${aRefaire ? ' · <span class="alerte">à faire</span>' : ""}
      ${nPhotos ? ` · ${nPhotos} en attente d'envoi` : ""}</span>
    <div class="sous" style="margin-top:6px">Lumière naturelle, même endroit, toutes les 4 semaines.</div>
    <div class="ligne2"><button data-photo="posture-profil">Posture de profil</button><button data-photo="peau">Peau</button>
      <button data-photo="autre">Autre</button></div></div>`;
  // La note générale, tout en bas : bilan de la séance, que Claude relit (seances.md, ligne « > »).
  h += `<div class="carte"><b>Note de séance</b> <span class="sous">ce que Claude relira pour tes bilans</span>
    <textarea id="note" style="margin-top:8px" placeholder="Comment ça s'est passé : forme, sensations, épaule, ce qui a coincé…">${esc(s.note)}</textarea></div>`;
  for (const x of ctx?.pause || []) h += `<p class="pause">⏸ ${esc(x.nom)} en pause : ${esc(x.raison)}</p>`;
  if (!ctx) h += `<p class="sous">Le PC n'a pas encore envoyé ton programme : il le fera à sa prochaine synchro.</p>`;
  app.innerHTML = h;
}

function formatSeries(series) {
  let prec, out = [];
  for (const [c, r] of series) { out.push(c !== prec ? `${kg(c)}×${r}` : String(r)); prec = c; }
  return out.join(", ");
}

// ───────────────────────────────────────── l'onglet Progrès

// Courbe en SVG, sans bibliothèque : marche hors ligne. points : [[date ISO, valeur]].
function courbe(titre, points, { fmt = (v) => String(Math.round(v)), refs = [], bande = null, couleur = "var(--bleu)",
                                 jours = 90, relier = 4, bas = null, haut = null, legende = "", ajuster = false } = {}) {
  const fin = new Date(jour);
  let debut = new Date(fin - (jours - 1) * 864e5);
  const pts = points.filter(([d, v]) => v != null && new Date(d) >= debut).sort((a, b) => a[0].localeCompare(b[0]));
  // Historique court sur une fenêtre longue : l'axe part du premier point, sinon tout se tasse à droite.
  if (ajuster && pts.length) debut = new Date(Math.max(debut, new Date(pts[0][0]) - 3 * 864e5));
  if (!pts.length) return `<div class="carte graphe"><h4>${esc(titre)}</h4><div class="sous">pas encore de mesure sur ${jours} jours</div></div>`;
  const vs = pts.map((p) => p[1]).concat(refs, bande || []).filter((v) => v != null);
  let lo = bas ?? Math.min(...vs), hi = haut ?? Math.max(...vs);
  if (hi === lo) { hi += 1; lo -= 1; }
  const m = (hi - lo) * 0.08; lo -= bas == null ? m : 0; hi += haut == null ? m : 0;
  const W = 340, H = 130, G = 46;
  const X = (d) => G + (new Date(d) - debut) / ((fin - debut) || 1) * (W - G - 6);
  const Y = (v) => 6 + (hi - v) / (hi - lo) * (H - 22);
  let svg = `<svg viewBox="0 0 ${W} ${H}">`;
  if (bande) svg += `<rect x="${G}" y="${Y(bande[1])}" width="${W - G - 6}" height="${Y(bande[0]) - Y(bande[1])}" fill="rgba(48,209,88,.12)"/>`;
  for (const r of refs) svg += `<line x1="${G}" x2="${W - 6}" y1="${Y(r)}" y2="${Y(r)}" stroke="var(--jaune)" stroke-dasharray="4 4" stroke-width="1"/>`;
  for (const v of [hi - m, (hi + lo) / 2, lo + m])
    svg += `<text x="${G - 4}" y="${Y(v) + 4}" fill="var(--doux)" font-size="10" text-anchor="end">${esc(fmt(v))}</text>`;
  svg += `<line x1="${G}" x2="${G}" y1="4" y2="${H - 16}" stroke="var(--ligne)"/>`;
  let chemin = "", prec = null;
  for (const [d, v] of pts) {
    const ecart = prec ? (new Date(d) - new Date(prec)) / 864e5 : 0;
    chemin += `${!prec || ecart > relier ? "M" : "L"}${X(d).toFixed(1)},${Y(v).toFixed(1)} `;
    prec = d;
  }
  svg += `<path d="${chemin}" fill="none" stroke="${couleur}" stroke-width="2" stroke-linejoin="round"/>`;
  for (const [d, v] of pts) svg += `<circle cx="${X(d).toFixed(1)}" cy="${Y(v).toFixed(1)}" r="${pts.length > 40 ? 1.5 : 2.5}" fill="${couleur}"/>`;
  svg += `<text x="${G}" y="${H - 3}" fill="var(--doux)" font-size="10">${jj(debut.toISOString())}</text>`;
  svg += `<text x="${W - 6}" y="${H - 3}" fill="var(--doux)" font-size="10" text-anchor="end">${jj(jour)}</text></svg>`;
  const vals = pts.map((p) => p[1]);
  const moy = vals.reduce((a, b) => a + b, 0) / vals.length;
  return `<div class="carte graphe"><h4>${esc(titre)}</h4>${svg}<div class="chiffres">dernière ${esc(fmt(vals[vals.length - 1]))}
    · moyenne ${esc(fmt(moy))} · ${vals.length} mesure${vals.length > 1 ? "s" : ""}${legende ? ` · ${esc(legende)}` : ""}</div></div>`;
}

function barresSemaines(semaines) {
  const W = 340, H = 110, hi = Math.max(1, ...semaines.map((s) => s[1])), lb = (W - 10) / semaines.length;
  let svg = `<svg viewBox="0 0 ${W} ${H}">`;
  semaines.forEach(([d, n], i) => {
    const h = n / hi * (H - 30);
    svg += `<rect x="${(5 + i * lb + 2).toFixed(1)}" y="${(H - 18 - h).toFixed(1)}" width="${(lb - 4).toFixed(1)}" height="${h.toFixed(1)}" rx="3" fill="var(--bleu)"/>`;
    if (n) svg += `<text x="${(5 + i * lb + lb / 2).toFixed(1)}" y="${(H - 21 - h).toFixed(1)}" fill="var(--texte)" font-size="10" text-anchor="middle">${n}</text>`;
    if (i % 2 === semaines.length % 2 || semaines.length < 8)
      svg += `<text x="${(5 + i * lb + lb / 2).toFixed(1)}" y="${H - 4}" fill="var(--doux)" font-size="9" text-anchor="middle">${jj(d)}</text>`;
  });
  return svg + "</svg>";
}

function muscuParJour() {
  // Le calendrier du PC, plus les séances du téléphone (plus récentes que sa dernière synchro).
  const out = { ...(ctx?.muscu_jours || {}) };
  for (const s of toutesSeances()) {
    const n = (s.exos || []).reduce((a, e) => a + (e.series?.length || 0), 0);
    if (n) out[s.jour] = { type: s.type, series: n };
  }
  return out;
}

function progres() {
  const mj = muscuParJour();
  const courses = new Set((ctx?.courses || []).map((c) => c[0]));
  // Calendrier : 18 semaines, du lundi au dimanche, une colonne par semaine.
  const fin = new Date(jour);
  const lundi = new Date(fin - ((fin.getDay() + 6) % 7) * 864e5);
  const debut = new Date(lundi - 17 * 7 * 864e5);
  let cases = "";
  for (let d = new Date(debut); d <= new Date(lundi.getTime() + 6 * 864e5); d = new Date(d.getTime() + 864e5)) {
    const iso = d.toISOString().slice(0, 10);
    const t = mj[iso]?.type || (courses.has(iso) ? "course" : "");
    cases += `<span class="${t} ${iso === jour ? "auj" : ""}" title="${iso}"></span>`;
  }
  const n30 = Object.keys(mj).filter((d) => (fin - new Date(d)) / 864e5 < 30).length;
  const legs = Object.entries(mj).filter(([, x]) => x.type === "legs").map(([d]) => d).sort();
  let h = `<div class="carte"><b>Régularité</b> <span class="sous">${n30} séances sur 30 jours${legs.length ? ` · jambes il y a ${Math.round((fin - new Date(legs[legs.length - 1])) / 864e5)} j` : ""}</span>
    <div class="cal" style="margin-top:10px">${cases}</div>
    <div class="legende"><span><i style="background:var(--bleu)"></i>push</span><span><i style="background:var(--violet)"></i>pull</span>
      <span><i style="background:var(--vert)"></i>legs</span><span><i style="background:var(--jaune)"></i>course</span><span><i style="background:var(--doux)"></i>autre</span></div></div>`;

  // Séries par semaine, 12 semaines.
  const sem = [];
  for (let k = 11; k >= 0; k--) {
    const de = new Date(lundi - k * 7 * 864e5), a = new Date(de.getTime() + 7 * 864e5);
    const n = Object.entries(mj).filter(([d]) => new Date(d) >= de && new Date(d) < a).reduce((s, [, x]) => s + x.series, 0);
    sem.push([de.toISOString().slice(0, 10), n]);
  }
  h += `<div class="carte graphe"><h4>Séries par semaine</h4>${barresSemaines(sem)}</div>`;
  h += carteCorps(lundi.toISOString().slice(0, 10));
  h += carteEquilibre();

  // Un exercice : 1RM estimé et charge la plus haute de chaque séance.
  const prog = { ...(ctx?.progres || {}) };
  for (const s of toutesSeances()) for (const e of s.exos || []) {
    if (!e.series?.length) continue;
    const top = Math.max(...e.series.map((x) => x.c ?? 0));
    const best = Math.max(...e.series.map((x) => (x.c > 0 && x.r <= 12 ? x.c * (1 + x.r / 30) : 0)));
    const l = (prog[e.nom] = (prog[e.nom] || []).filter((p) => p[0] !== s.jour));
    l.push([s.jour, top, Math.round(best * 10) / 10]);
  }
  const noms = Object.keys(prog).sort((a, b) => prog[b].length - prog[a].length);
  if (noms.length) {
    if (!noms.includes(exoGraphe)) exoGraphe = noms[0];
    const serie = prog[exoGraphe].slice().sort((a, b) => a[0].localeCompare(b[0]));
    h += `<div class="carte graphe"><select id="choix-exo">${noms.map((n) => `<option ${n === exoGraphe ? "selected" : ""}>${esc(n)}</option>`).join("")}</select></div>`;
    h += courbe(`${exoGraphe} — 1RM estimé`, serie.map((p) => [p[0], p[2] || null]), { jours: 365, relier: 30, couleur: "var(--violet)", ajuster: true,
      fmt: (v) => `${Math.round(v)} kg`, legende: "d'après la meilleure série" });
    h += courbe(`${exoGraphe} — charge la plus haute`, serie.map((p) => [p[0], p[1]]), { jours: 365, relier: 30, ajuster: true,
      fmt: (v) => `${String(Math.round(v * 2) / 2).replace(".", ",")} kg` });
  } else h += `<div class="carte sous">Les courbes de chaque exercice apparaîtront après tes premières séances.</div>`;

  // L'épaule et la course : le reste du corps est dans l'onglet Santé.
  const douleurs = (ctx?.douleurs || []).slice();
  for (const s of toutesSeances()) if (s.douleur != null) { const i = douleurs.findIndex((x) => x[0] === s.jour); if (i >= 0) douleurs.splice(i, 1); douleurs.push([s.jour, s.douleur]); }
  h += courbe("Douleur à l'épaule", douleurs, { bas: 0, haut: 10, refs: [2], relier: 14, couleur: "var(--rouge)", jours: 120, legende: "sous 2 : on peut remonter" });
  const cr = (ctx?.courses || []).map((c) => [c[0], c[2] / c[1]]);
  if (cr.length) h += courbe("Course — allure", cr, { jours: 365, relier: 30, couleur: "var(--jaune)", ajuster: true,
    fmt: (v) => `${Math.floor(v)}'${String(Math.round((v % 1) * 60)).padStart(2, "0")}`, legende: "min/km, plus bas = plus rapide" });
  if (ctx?.genere) h += `<p class="sous">Données du PC du ${jj(ctx.genere)} à ${ctx.genere.slice(11, 16)}.</p>`;
  return h;
}

// La silhouette : séries de la semaine par muscle, ou récupération (même calcul que le panneau).
// Chaque groupe d'exercices.md correspond à une ou plusieurs zones du dessin, de face ou de dos.
const ZONES = {
  pecs: [["face", "chest"]], dos: [["dos", "upperBack"], ["dos", "lowerBack"], ["dos", "rotatorCuff"]],
  "épaules": [["face", "deltoids"]], "épaules arrière": [["dos", "deltoids"]], triceps: [["face", "triceps"], ["dos", "triceps"]],
  biceps: [["face", "biceps"]], "avant-bras": [["face", "forearm"], ["dos", "forearm"]],
  quadriceps: [["face", "quadriceps"], ["face", "hipFlexors"]], ischios: [["dos", "hamstring"]], fessiers: [["dos", "gluteal"]],
  adducteurs: [["face", "adductors"], ["dos", "adductors"]], mollets: [["face", "calves"], ["dos", "calves"]],
  abdos: [["face", "abs"], ["face", "obliques"], ["face", "serratus"]],
  cou: [["face", "neck"], ["face", "trapezius"], ["dos", "neck"], ["dos", "trapezius"]],
};
const ZONE_GROUPE = Object.fromEntries(Object.entries(ZONES).flatMap(([g, zs]) => zs.map(([v, m]) => [`${v}:${m}`, g])));
let modeCorps = lire("carnet:corps", "volume");

function silhouette(couleurs) {
  return `<div class="corps">${["face", "dos"].map((v) => `<svg viewBox="${CORPS[v].vb}" role="img" aria-label="${v === "face" ? "de face" : "de dos"}">`
    + Object.entries(CORPS[v].m).map(([m, d]) => {
      const g = ZONE_GROUPE[`${v}:${m}`];
      return `<path d="${d}" fill="${g ? couleurs[g] || "var(--repos)" : "var(--carte2)"}"/>`;
    }).join("") + `</svg>`).join("")}</div>`;
}

function carteCorps(lundi) {
  let couleurs = {}, detail = "", legende = "";
  if (modeCorps === "recup") {
    const rc = recup();
    for (const [g, f] of Object.entries(rc)) couleurs[g] = `var(--${etatRecup(f)})`;
    const tri = Object.entries(rc).sort((a, b) => b[1] - a[1]);
    detail = tri.length ? tri.map(([g, f]) => `<span class="${etatRecup(f)}">${esc(g)} ${Math.round(f * 100)} %</span>`).join(" · ")
      : "rien de travaillé ces 7 derniers jours";
    legende = `<span><i style="background:var(--rouge)"></i>fatigué</span><span><i style="background:var(--jaune)"></i>presque</span>
      <span><i style="background:var(--vert)"></i>prêt</span><span><i style="background:var(--repos)"></i>pas travaillé</span>`;
  } else {
    const v = volume(lundi);
    // 10 séries par muscle et par semaine : le bas de la fourchette conseillée pour progresser.
    for (const [g, n] of Object.entries(v)) couleurs[g] = n >= 10 ? "var(--vert)" : n >= 6 ? "rgba(48,209,88,.6)" : "rgba(48,209,88,.3)";
    const tri = Object.entries(v).sort((a, b) => b[1] - a[1]);
    detail = tri.length ? tri.map(([g, n]) => `${esc(g)} ${n}`).join(" · ") : "aucune série cette semaine";
    legende = `<span><i style="background:rgba(48,209,88,.3)"></i>1-5</span><span><i style="background:rgba(48,209,88,.6)"></i>6-9</span>
      <span><i style="background:var(--vert)"></i>10 et plus</span><span><i style="background:var(--repos)"></i>0</span>`;
  }
  return `<div class="carte"><div class="c-tete"><b>${modeCorps === "recup" ? "Récupération" : "Séries de la semaine"}</b>
      <span class="sous">par muscle</span></div>
    <div class="periode"><button data-corps="volume" class="${modeCorps !== "recup" ? "choisi" : ""}">Volume</button>
      <button data-corps="recup" class="${modeCorps === "recup" ? "choisi" : ""}">Récupération</button></div>
    ${silhouette(couleurs)}<div class="legende">${legende}</div><div class="sous" style="margin-top:6px">${detail}</div></div>`;
}

function carteEquilibre() {
  // Tirer / pousser sur 4 semaines : pour la posture et l'épaule droite, au moins autant de tirage.
  const tp = ctx?.tirer_pousser;
  if (!tp) return "";
  const debut = new Date(new Date(jour) - 27 * 864e5).toISOString().slice(0, 10), v = volume(debut);
  const t = tp.tirer.reduce((a, g) => a + (v[g] || 0), 0), p = tp.pousser.reduce((a, g) => a + (v[g] || 0), 0);
  if (!t && !p) return "";
  const r = p ? t / p : null, ton = r == null || r >= 1 ? "vert" : r >= 0.8 ? "jaune" : "rouge";
  return `<div class="carte"><div class="c-tete"><b>Tirer / pousser</b><span class="sous">séries sur 4 semaines</span></div>
    <div class="eq"><i style="flex:${t || 0.01};background:var(--violet)"></i><i style="flex:${p || 0.01};background:var(--bleu)"></i></div>
    <div class="j-haut" style="margin-top:6px"><span>tirer <b>${t}</b></span><span class="${ton}">${r == null ? "" : `rapport ${virgule(r)}`}</span><span>pousser <b>${p}</b></span></div>
    <div class="sous" style="margin-top:6px">${ton === "vert" ? "Équilibré. " : "Trop de poussée. "}Pour la posture (épaules enroulées) et l'épaule droite, vise au moins autant de séries de tirage (dos, épaules arrière, biceps) que de poussée (pecs, épaules, triceps).</div></div>`;
}

// ───────────────────────────────────────── l'onglet Santé

// Les données de la montre (résumés par jour) et les calculs du panneau Santé, poussés par le PC.
// Mêmes seuils que le panneau : des repères tirés d'une montre, pas un diagnostic.
const hm = (mn) => `${Math.floor(mn / 60)}h${String(Math.round(mn % 60)).padStart(2, "0")}`;
const virgule = (v, n = 1) => String(Math.round(v * 10 ** n) / 10 ** n).replace(".", ",");
const quand = (iso) => (iso === jour ? "aujourd'hui" : (new Date(jour) - new Date(iso)) / 864e5 === 1 ? "hier" : `le ${jj(iso)}`);
let periode = lire("carnet:periode", 30);

function pesees() {
  // Celles du PC (poids.md et Garmin), plus celles du téléphone pas encore repassées par lui.
  const p = (ctx?.pesees || []).slice();
  for (const s of toutesSeances()) if (s.poids) { const i = p.findIndex((x) => x[0] === s.jour); if (i >= 0) p.splice(i, 1); p.push([s.jour, s.poids]); }
  return p.sort((a, b) => a[0].localeCompare(b[0]));
}

function tuile(titre, valeur, unite, sous, ton) {
  return `<div class="tuile"><div class="t-titre"><i class="pastille ${ton || ""}"></i>${esc(titre)}</div>
    <div class="t-val">${valeur ?? "–"}<small>${valeur != null ? esc(unite) : ""}</small></div><div class="t-sous">${sous || "&nbsp;"}</div></div>`;
}

function jauge(titre, fait, cible, texte) {
  const k = cible ? Math.min(1, (fait || 0) / cible) : 0;
  return `<div class="jauge-l"><div class="j-haut"><span>${esc(titre)}</span><span>${texte}</span></div>
    <div class="j-barre"><i style="width:${(k * 100).toFixed(0)}%;background:${k >= 1 ? "var(--vert)" : "var(--bleu)"}"></i></div></div>`;
}

// Les gestes du téléphone (ressenti, routine, note du jour, objectifs) partent avec la séance du jour,
// datés : le PC les écrit dans journal.md et objectifs.md comme le panneau, une fois chacun. Ici, un
// geste prime sur l'état du PC tant que celui-ci ne l'a pas appliqué (ctx.sante.gestes).
const maintenant = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 23); };

function geste(champ, cle, v) {
  const s = seanceDuJour();
  s[champ] = { ...(s[champ] || {}), [cle]: { v, t: maintenant() } };
  sauver();
}

function etatGeste(champ, cle, base) {
  const g = doc?.[champ]?.[cle];
  const vu = ctx?.sante?.jour === jour ? ctx.sante.gestes?.[champ === "objectifs" ? `objectif:${cle}` : cle] : null;
  return g && (!vu || g.t > vu) ? g.v : base;
}

function journalDuJour() {
  // Ce que le PC sait de la ligne du jour de journal.md, recouvert par les gestes pas encore appliqués.
  const S = ctx?.sante, base = S?.jour === jour ? S.journal : {};
  const j = { Fait: {} };
  for (const k of ["Énergie", "Humeur", "Peau"]) j[k] = etatGeste("journal", k, base?.[k] ?? null);
  j.Note = etatGeste("journal", "Note", base?.Note || "");
  for (const r of S?.routine || []) j.Fait[r.cle] = etatGeste("journal", `Fait:${r.cle}`, (base?.Fait || []).includes(r.cle));
  return j;
}

function aujourdhuiSante() {
  const S = ctx?.sante, j = journalDuJour();
  const routine = S?.routine || [];
  const ton = (v) => (v >= 4 ? "var(--vert)" : v === 3 ? "var(--jaune)" : "var(--rouge)");
  let h = `<div class="carte"><b>Ressenti du jour</b> <span class="sous">de 1 à 5, 5 = au mieux</span><div class="notes">`;
  for (const k of ["Énergie", "Humeur", "Peau"])
    h += `<span class="r-nom">${k}</span><span class="cinq">${[1, 2, 3, 4, 5].map((n) => `<button data-ressenti="${k}" data-n="${n}"
      class="${j[k] === n ? "choisi" : ""}" style="${j[k] === n ? `background:${ton(n)}` : ""}">${n}</button>`).join("")}</span>`;
  h += `</div><textarea id="note-jour" placeholder="Note du jour : sommeil, forme, ce qui a compté…">${esc(j.Note)}</textarea></div>`;
  if (routine.length) {
    const n = routine.filter((r) => j.Fait[r.cle] || r.auto).length;
    h += `<div class="carte"><b>Routine du jour</b> <span class="sous">${n}/${routine.length}</span>`
      + routine.map((r) => { const ok = j.Fait[r.cle] || r.auto;
        return `<button class="case ${ok ? "faite" : ""}" data-routine="${esc(r.cle)}" ${r.auto ? "disabled" : ""}><i>${ok ? "✓" : ""}</i>
          <span><b>${esc(r.titre)}</b>${r.detail ? `<span class="sous">${esc(r.detail)}</span>` : ""}</span></button>`; }).join("")
      + `</div>`;
  }
  return h;
}

function sante() {
  const S = ctx?.sante;
  if (!S) return `<div class="carte sous">Le PC n'a pas encore envoyé tes données de santé : il le fera à sa prochaine synchro.</div>`;
  const J = ctx.jours || [], C = S.cibles || {};
  const dernier = (cle) => { for (let i = J.length - 1; i >= 0; i--) if (J[i][cle] != null) return J[i]; return null; };
  let h = "";

  for (const a of S.alertes || []) h += `<div class="carte alerte-carte">${esc(a)}</div>`;
  h += aujourdhuiSante();

  // La dernière nuit connue : durée face à la cible, horaires, phases.
  const n = dernier("sommeil");
  if (n) {
    const ph = [["profond", "Profond", "#5e5ce6"], ["leger", "Léger", "#0a84ff"], ["paradoxal", "Paradoxal", "#64d2ff"], ["eveil", "Éveil", "#ff9f0a"]]
      .filter(([k]) => n[k]);
    const tot = ph.reduce((s, [k]) => s + n[k], 0) || 1;
    const ok = n.sommeil >= C.sommeil, court = n.sommeil < C.sommeil - 60;
    h += `<div class="carte"><div class="c-tete"><b>Nuit</b><span class="sous">${quand(n.j)}${n.couche ? ` · ${n.couche} → ${n.leve}` : ""}</span></div>
      <div class="nuit"><div class="t-val grand ${ok ? "vert" : court ? "rouge" : "jaune"}">${hm(n.sommeil)}</div>
        <div class="sous">cible ${hm(C.sommeil)}${n.score ? `<br>score <b class="score">${n.score}</b>` : ""}</div></div>
      <div class="phases">${ph.map(([k, , c]) => `<i style="width:${(n[k] / tot * 100).toFixed(1)}%;background:${c}"></i>`).join("")}</div>
      <div class="legende">${ph.map(([k, nom, c]) => `<span><i style="background:${c}"></i>${nom} ${hm(n[k])}</span>`).join("")}</div></div>`;
  } else h += `<div class="carte sous">Aucune nuit enregistrée récemment : porte la montre la nuit, puis ouvre Garmin Connect pour la synchroniser.</div>`;

  // Les mesures du matin, chacune à sa dernière valeur connue.
  const v = dernier("vfc"), fc = dernier("fc"), bb = dernier("bb"), st = dernier("stress"), sp = dernier("spo2"), rs = dernier("resp");
  const tonVfc = !v ? "" : v.vfc_bas && v.vfc < v.vfc_bas ? "jaune" : "vert";
  const tonFc = !fc || !S.fc30 ? "" : fc.fc >= S.fc30 + 5 ? "rouge" : fc.fc > S.fc30 + 2 ? "jaune" : "vert";
  const tonBb = !bb ? "" : bb.bb < 40 ? "rouge" : bb.bb < 70 ? "jaune" : "vert";
  const tonSt = !st ? "" : st.stress > 50 ? "rouge" : st.stress > 25 ? "jaune" : "vert";
  h += `<div class="tuiles">`
    + tuile("VFC", v?.vfc, " ms", v ? (v.vfc_bas ? `habituel ${v.vfc_bas}–${v.vfc_haut}${v.j < jour ? ` · ${quand(v.j)}` : ""}` : quand(v.j)) : "", tonVfc)
    + tuile("FC au repos", fc?.fc, " bpm", fc ? (S.fc30 ? `moyenne ${S.fc30} · ${quand(fc.j)}` : quand(fc.j)) : "", tonFc)
    + tuile("Body Battery", bb?.bb, "", bb ? `max${bb.bb_min != null ? ` · min ${bb.bb_min}` : ""} · ${quand(bb.j)}` : "", tonBb)
    + tuile("Stress", st?.stress, "", st ? `moyenne · ${quand(st.j)}` : "", tonSt)
    + tuile("SpO2", sp ? Math.round(sp.spo2) : null, " %", sp ? `nuit · ${quand(sp.j)}` : "", sp ? (sp.spo2 < 92 ? "rouge" : "vert") : "")
    + tuile("Respiration", rs ? Math.round(rs.resp) : null, " /min", rs ? `éveil · ${quand(rs.j)}` : "", "")
    + `</div>`;

  // La semaine en cours.
  const auj = J.find((x) => x.j === jour);
  const lundi = new Date(new Date(jour) - ((new Date(jour).getDay() + 6) % 7) * 864e5).toISOString().slice(0, 10);
  const nSeances = Math.max(S.seances_semaine || 0, Object.keys(muscuParJour()).filter((d) => d >= lundi && d <= jour).length);
  h += `<div class="carte"><b>Cette semaine</b>`
    + jauge("Pas aujourd'hui", auj?.pas, C.pas, `${(auj?.pas || 0).toLocaleString("fr-FR")} / ${C.pas.toLocaleString("fr-FR")}`)
    + jauge("Séances", nSeances, C.seances, `${nSeances} / ${C.seances}`)
    + jauge("Minutes intensives", S.intensif_semaine, C.intensif, `${S.intensif_semaine ?? 0} / ${C.intensif}`)
    + `</div>`;

  // Le sommeil sur la semaine : dette, régularité, heure conseillée.
  const r = S.regularite;
  h += `<div class="carte"><b>Sommeil</b><div class="lignes">
    <div><span>Dette sur 7 nuits</span><b class="${S.dette > 240 ? "rouge" : S.dette > 120 ? "jaune" : ""}">${S.nuits ? hm(S.dette) : "–"}</b></div>
    <div><span>Coucher moyen</span><b>${r ? `${r.heure} <small class="sous">± ${r.ecart} min</small>` : "–"}</b></div>
    <div><span>Ce soir, au lit à</span><b class="bleu">${esc(S.coucher_conseil)}</b></div></div>
    ${r ? `<div class="sous">${r.ecart <= 30 ? "Horaires réguliers" : "Horaires irréguliers : vise la même heure chaque soir"} (${r.nuits} nuits).</div>` : ""}</div>`;

  // Le ressenti noté dans le panneau, 14 derniers jours.
  const res = Object.fromEntries((S.ressenti || []).map((x) => [x[0], x]));
  const jours14 = Array.from({ length: 14 }, (_, k) => new Date(new Date(jour) - (13 - k) * 864e5).toISOString().slice(0, 10));
  const coul = (x) => (x == null ? "" : `background:${["#ff453a", "#ff9f0a", "#ffd60a", "#a4e05a", "#30d158"][x - 1]}`);
  h += `<div class="carte"><b>Ressenti</b> <span class="sous">14 jours, noté dans le panneau</span><div class="ressenti">`
    + [["Énergie", 1], ["Humeur", 2], ["Peau", 3]].map(([nom, i]) => {
      const vals = jours14.map((d) => res[d]?.[i] ?? null), notes = vals.filter((x) => x != null);
      return `<span class="r-nom">${nom}</span><span class="points">${vals.map((x) => `<i style="${coul(x)}"></i>`).join("")}</span>
        <span class="r-moy">${notes.length ? virgule(notes.reduce((a, b) => a + b, 0) / notes.length) : "–"}</span>`;
    }).join("") + `</div></div>`;

  // Les tendances, sur la période choisie.
  const pt = (cle) => J.map((x) => [x.j, x[cle]]);
  const o = { jours: periode, relier: periode > 30 ? 4 : 2 };
  h += `<div class="periode">${[30, 90].map((p) => `<button data-periode="${p}" class="${p === periode ? "choisi" : ""}">${p} jours</button>`).join("")}</div>`;
  const pes = pesees();
  h += courbe("Poids", pes, { relier: 60, jours: 365, ajuster: true, fmt: (v) => virgule(v), legende: "kg" });
  h += courbe("Sommeil", pt("sommeil"), { ...o, refs: [C.sommeil], fmt: hm, couleur: "#5e5ce6", legende: "pointillés : ta cible" });
  h += courbe("VFC (nuit)", pt("vfc"), { ...o, bande: v?.vfc_bas ? [v.vfc_bas, v.vfc_haut] : null, couleur: "var(--vert)", legende: "ms, bande verte : ton habituel" });
  h += courbe("FC au repos", pt("fc"), { ...o, couleur: "var(--rouge)", legende: "bpm" });
  h += courbe("Body Battery", pt("bb"), { ...o, bas: 0, haut: 100, couleur: "#64d2ff", legende: "maximum du jour" });
  h += courbe("Stress", pt("stress"), { ...o, bas: 0, couleur: "#ff9f0a", legende: "moyenne du jour" });
  h += courbe("Pas", pt("pas"), { ...o, refs: [C.pas], bas: 0, fmt: (v) => (v >= 1000 ? `${virgule(v / 1000)}k` : String(Math.round(v))), couleur: "var(--bleu)" });
  h += courbe("Heure de coucher", pt("coucher"), { ...o, fmt: (v) => { const t = Math.round(v) + 1080; return `${String(Math.floor(t / 60) % 24).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`; },
    couleur: "var(--violet)", legende: "plus c'est plat, plus c'est régulier" });

  if (S.objectifs?.length) {
    const obj = S.objectifs.map((x) => ({ ...x, ok: etatGeste("objectifs", x.texte, x.fait) }));
    h += `<div class="carte"><b>Objectifs</b> <span class="sous">${obj.filter((x) => x.ok).length}/${obj.length}</span>`
      + obj.map((x) => `<button class="case ${x.ok ? "faite" : ""}" data-objectif="${esc(x.texte)}"><i>${x.ok ? "✓" : ""}</i>
        <span><b>${esc(x.texte)}</b>${x.ok && x.le ? `<span class="sous">atteint le ${esc(x.le)}</span>` : ""}</span></button>`).join("") + `</div>`;
  }
  h += `<p class="sous">Montre synchronisée jusqu'au ${S.montre ? jj(S.montre) : "–"}${ctx.genere ? ` · PC vu le ${jj(ctx.genere)} à ${ctx.genere.slice(11, 16)}` : ""}.
    Repères tirés d'une montre de sport, pas un avis médical.</p>`;
  return h;
}

// ───────────────────────────────────────── les gestes

let sansClic = 0;   // après un glissement sur une série, le clic qui suit ne la sélectionne pas
document.addEventListener("click", (ev) => {
  if (Date.now() - sansClic < 450) return;
  const t = ev.target.closest("button, h3, [data-ligne], [data-memo]");
  if (!t) return;
  const carte = t.closest("[data-exo]");
  const nom = carte?.dataset.exo;
  const s = seanceDuJour();
  if (t.dataset.fiche) {
    ouvrirFiche(t.dataset.fiche); return;
  } else if (t.closest("[data-memo]")) {
    memoEdite = t.closest("[data-memo]").dataset.memo;
    dessiner(); setTimeout(() => $("#memo-champ")?.focus(), 0); return;
  } else if (t.hasAttribute("data-memo-ok")) {
    const v = $("#memo-champ").value.trim().replace(/\|/g, "/");
    ecrire(`carnet:memo:${memoEdite}`, v);
    s.memos = { ...(s.memos || {}), [memoEdite]: v };   // part au PC avec la séance du jour
    memoEdite = null; sauver();
  } else if (t.dataset.onglet) {
    onglet = t.dataset.onglet; window.scrollTo(0, 0);
  } else if (t.dataset.ressenti) {
    const k = t.dataset.ressenti, n = Number(t.dataset.n);
    geste("journal", k, journalDuJour()[k] === n ? null : n);   // retoucher la même note l'efface, comme au panneau
  } else if (t.dataset.routine) {
    geste("journal", `Fait:${t.dataset.routine}`, !journalDuJour().Fait[t.dataset.routine]);
  } else if (t.dataset.objectif) {
    const x = ctx?.sante?.objectifs?.find((o) => o.texte === t.dataset.objectif);
    if (x) geste("objectifs", x.texte, !etatGeste("objectifs", x.texte, x.fait));
  } else if (t.dataset.corps) {
    modeCorps = t.dataset.corps; ecrire("carnet:corps", modeCorps);
  } else if (t.dataset.reserve != null) {
    const { e, ks } = lignesDe(nom), x = e?.series?.[ks];
    if (x) { const k = Number(t.dataset.reserve); if (x.e === k) delete x.e; else x.e = k; sauver(); }
  } else if (t.dataset.periode) {
    periode = Number(t.dataset.periode); ecrire("carnet:periode", periode);
  } else if (t.dataset.douleur != null) {
    const v = Number(t.dataset.douleur);
    s.douleur = s.douleur === v ? null : v; sauver();
  } else if (t.hasAttribute("data-poids-ok")) {
    const v = parseFloat(($("#poids").value || "").replace(",", "."));
    if (v > 30 && v < 250) { s.poids = v; sauver(); } else { s.poids = null; sauver(); }
  } else if (t.dataset.photo) {
    genrePhoto = t.dataset.photo; $("#fichier-photo").click(); return;
  } else if (t.dataset.exoGraphe != null) {
    return;
  } else if (t.dataset.type) {
    s.type = t.dataset.type; ouvert = null; choisie = null; saisie = {}; sauver();
  } else if (t.dataset.ouvrir != null) {
    ouvert = ouvert === nom ? null : nom; choisie = null;
  } else if (t.dataset.pas || t.dataset.reps) {
    // Régler la ligne sélectionnée : une série faite est corrigée en place, une prévue est notée
    // dans les réglages (et les lignes prévues suivantes la suivent).
    const { e, L, ks, st } = lignesDe(nom), l = L.find((x) => x.k === ks);
    if (!l) return;
    const c = t.dataset.pas ? Math.max(0, Math.round((Number(l.c || 0) + Number(t.dataset.pas)) * 4) / 4) : l.c;
    const r = t.dataset.reps ? Math.max(1, l.r + Number(t.dataset.reps)) : l.r;
    if (l.fait) { Object.assign(e.series[ks], { c, r }); sauver(); }
    else st.edits[ks] = { c, r };
  } else if (t.hasAttribute("data-valider") || t.hasAttribute("data-cocher")) {
    const { L, k0, n, st, der, ci } = lignesDe(nom), l = L.find((x) => x.k === k0);
    if (!l) return;
    let e = s.exos.find((x) => x.nom === nom);
    if (!e) { e = { nom, series: [] }; s.exos.push(e); }
    if (e.series.length >= n) st.extra = Math.max(0, st.extra - 1);   // une série ajoutée en plus est faite
    e.series.push({ c: l.c, r: l.r, t: new Date().toTimeString().slice(0, 8) });
    delete st.edits[k0];
    choisie = null; ouvert = nom;
    navigator.vibrate?.(30);
    sauver();
    if (e.series.length >= n && !L.some((x) => x.k > k0)) finExercice(nom);
    else {
      const suiv = L.find((x) => x.k === k0 + 1);
      lancerRepos(nom, `${nom} · série ${e.series.length + 1}/${Math.max(n, L.length)} ensuite`, suiv ? `${kg(suiv.c)} kg × ${suiv.r}` : "");
    }
    minu.effort = { nom, i: e.series.length - 1 }; garder();   // l'effort se note pendant le repos
  } else if (t.dataset.ligne != null) {
    const nm = t.dataset.nom, k = Number(t.dataset.ligne);
    if (ouvert === nm && choisie?.[0] === nm && choisie[1] === k) choisie = null;
    else { ouvert = nm; choisie = [nm, k]; }
  } else if (t.hasAttribute("data-retirer")) {
    const { ks } = lignesDe(nom);
    retirerSerie(nom, ks);
  } else if (t.hasAttribute("data-deselect")) {
    choisie = null;
  } else if (t.hasAttribute("data-plus-serie")) {
    lignesDe(nom).st.extra++;
  } else if (t.id === "ajouter") {
    ouvrirAjout(); return;
  } else return;
  dessiner();
});

document.addEventListener("change", (ev) => {
  if (ev.target.id === "choix-exo") { exoGraphe = ev.target.value; ecrire("carnet:exo-graphe", exoGraphe); dessiner(); }
});

// ───────────────────────────────────────── photos de suivi

// Redimensionnées sur le téléphone (1280 px, JPEG) : une photo de 4 Mo en fait ~200 ko. Gardées
// ici jusqu'à l'envoi ; la base n'est qu'un transit, le PC les range puis les efface.
let genrePhoto = "autre";
$("#fichier-photo").addEventListener("change", async (ev) => {
  const fichier = ev.target.files?.[0];
  ev.target.value = "";
  if (!fichier) return;
  try {
    const img = await createImageBitmap(fichier);
    const k = Math.min(1, 1280 / Math.max(img.width, img.height));
    const cv = document.createElement("canvas");
    cv.width = Math.round(img.width * k); cv.height = Math.round(img.height * k);
    cv.getContext("2d").drawImage(img, 0, 0, cv.width, cv.height);
    const donnees = cv.toDataURL("image/jpeg", 0.82);
    const file = lire("carnet:photos", []);
    file.push({ jour, genre: genrePhoto, donnees });
    ecrire("carnet:photos", file);
    if (lire("carnet:photos", []).length !== file.length) throw new Error("mémoire du navigateur pleine");
    etat("attente", "photo à envoyer");
    dessiner();
    envoyerPhotos();
  } catch (e) {
    etat("erreur", `photo : ${e.message}`);
  }
});

async function envoyerPhotos() {
  let file = lire("carnet:photos", []);
  while (file.length) {
    const p = file[0];
    try {
      await api("carnet_photo_deposer", { p_jour: p.jour, p_genre: p.genre, p_donnees: p.donnees });
    } catch (e) {
      etat("attente", "photo gardée ici, envoi plus tard");
      return;
    }
    file = lire("carnet:photos", []).slice(1);
    ecrire("carnet:photos", file);
  }
  dessiner();
}

document.addEventListener("input", (ev) => {
  if (ev.target.id === "note") { seanceDuJour().note = ev.target.value; sauver(); }
  if (ev.target.id === "note-jour") geste("journal", "Note", ev.target.value);
  if (ev.target.hasAttribute("data-note-exo")) {
    const nom = ev.target.closest("[data-exo]").dataset.exo, s = seanceDuJour();
    let e = s.exos.find((x) => x.nom === nom);
    if (!e) { e = { nom, series: [] }; s.exos.push(e); }
    e.note = ev.target.value;
    sauver();
  }

});

// Fiche d'un exercice : la machine en photo (départ, arrivée), son nom anglais pour la reconnaître
// ou demander à la salle, les muscles, trois consignes, l'erreur à éviter, et le mémo de réglage.
function ouvrirFiche(nom) {
  const f = FICHES[nom], mm = memo(nom);
  $("#fiche-contenu").innerHTML = `<div class="f-images">${[0, 1].map((i) => `<figure><img src="fiches/${f.img}-${i}.jpg" alt="" loading="lazy"><figcaption>${i ? "arrivée" : "départ"}</figcaption></figure>`).join("")}</div>
    <h2>${esc(nom)}</h2><div class="f-en">${esc(f.en)}</div>
    <div class="sous">${esc(f.muscles)}</div>
    ${mm ? `<div class="memo">📌 ${esc(mm)}</div>` : ""}
    <ol>${f.consignes.map((c) => `<li>${esc(c)}</li>`).join("")}</ol>
    <div class="remarque">✕ ${esc(f.erreur)}</div>`;
  $("#fiche").showModal();
}
$("#fiche").addEventListener("click", (ev) => { if (ev.target.id === "fiche" || ev.target.id === "fermer-fiche") $("#fiche").close(); });

// Ajouter un exercice hors programme : la liste du PC, ou un nom libre (le PC le signalera).
function ouvrirAjout() {
  const dlg = $("#ajout"), champ = $("#cherche");
  const rendu = () => {
    const q = champ.value.trim().toLowerCase();
    // Nom, alias (« pec fly » → Écarté machine) ou groupe, sans tenir compte des accents.
    const plat = (s) => (s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    const qp = plat(q);
    const liste = (ctx?.exercices || []).filter((x) => !q || plat(x.nom).includes(qp)
      || plat(x.alias).includes(qp) || plat(x.groupe).includes(qp));
    $("#choix").innerHTML = liste.map((x) => `<button data-choix="${esc(x.nom)}">${esc(x.nom)} <span>${esc(x.groupe)}${x.alias ? ` · ${esc(x.alias)}` : ""}</span></button>`).join("")
      + (q && !liste.some((x) => x.nom.toLowerCase() === q) ? `<button data-choix="${esc(champ.value.trim())}">+ « ${esc(champ.value.trim())} »</button>` : "");
  };
  champ.value = ""; rendu(); champ.oninput = rendu;
  dlg.showModal(); champ.focus();
}
$("#choix").addEventListener("click", (ev) => {
  const b = ev.target.closest("[data-choix]");
  if (!b) return;
  const s = seanceDuJour(), nom = b.dataset.choix;
  if (!s.exos.find((x) => x.nom === nom)) s.exos.push({ nom, series: [] });
  ouvert = nom; $("#ajout").close(); sauver(); dessiner();
});
$("#fermer-ajout").addEventListener("click", () => $("#ajout").close());

// ───────────────────────────────────────── glisser une série

// Vers la gauche : retirée (Annuler pendant 5 s). Vers la droite : recopiée (même charge, mêmes
// répétitions), pour la série identique qu'on vient de refaire.
let glisse = null, annulation = null;
document.addEventListener("touchstart", (ev) => {
  const el = ev.target.closest(".ls.fait, .serie");
  glisse = el ? { el, x: ev.touches[0].clientX, y: ev.touches[0].clientY } : null;
}, { passive: true });
document.addEventListener("touchmove", (ev) => {
  if (!glisse) return;
  const dx = ev.touches[0].clientX - glisse.x;
  if (Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(ev.touches[0].clientY - glisse.y)) {
    glisse.el.style.transform = `translateX(${dx}px)`;
    glisse.el.style.background = dx < -60 ? "var(--rouge)" : dx > 60 ? "var(--vert)" : "";
  }
}, { passive: true });
document.addEventListener("touchend", (ev) => {
  if (!glisse) return;
  const { el, x, y } = glisse;
  glisse = null;
  const dx = ev.changedTouches[0].clientX - x, dy = ev.changedTouches[0].clientY - y;
  el.style.transform = ""; el.style.background = "";
  if (Math.abs(dx) < 60 || Math.abs(dy) > Math.abs(dx)) return;
  sansClic = Date.now();
  const nom = el.dataset.nom, i = Number(el.dataset.ligne), e = seanceDuJour().exos.find((z) => z.nom === nom);
  if (!e?.series?.[i]) return;
  if (dx < 0) retirerSerie(nom, i);
  else {
    e.series.splice(i + 1, 0, { c: e.series[i].c, r: e.series[i].r, t: new Date().toTimeString().slice(0, 8) });
    decaler(nom, i, 1);
    toast(`Série ${kg(e.series[i].c)}×${e.series[i].r} recopiée`, false);
  }
  navigator.vibrate?.(25);
  choisie = null; sauver(); dessiner();
});

let toastFin = null;
function toast(texte, annulable) {
  const t = $("#toast");
  t.innerHTML = `<span>${esc(texte)}</span>${annulable ? `<button id="annuler">Annuler</button>` : ""}`;
  t.classList.add("vu");
  clearTimeout(toastFin);
  toastFin = setTimeout(() => { t.classList.remove("vu"); annulation = null; }, 5000);
}
$("#toast").addEventListener("click", (ev) => {
  if (ev.target.id !== "annuler" || !annulation) return;
  const s = seanceDuJour(), { nom, i, serie, ordre } = annulation;
  let e = s.exos.find((z) => z.nom === nom);
  if (!e) { e = { nom, series: [] }; s.exos.splice(Math.min(ordre, s.exos.length), 0, e); }
  e.series.splice(Math.min(i, e.series.length), 0, serie);
  decaler(nom, i - 1, 1);
  annulation = null; $("#toast").classList.remove("vu"); sauver(); dessiner();
});

// ───────────────────────────────────────── repos entre les séries

// Durée par défaut : 2 min 30 sur les polyarticulaires (développés, tirages, presse…), 1 min 30 sur
// l'isolation. Un ajustement ±15 s pendant le repos devient la durée de cet exercice la fois suivante.
// Après la dernière série d'un exercice, pas de compte à rebours : le changement de machine fait le
// repos ; un bouton en propose un si besoin.
const POLY = /développé|tirage|rowing|presse|traction|squat|soulevé|dips|fente|hip thrust/i;
const reposDe = (nom) => lire(`carnet:repos:${nom}`) ?? (POLY.test(nom) ? 150 : 90);
let minu = lire("carnet:minuteur");   // {nom, quoi, cible, duree, fin, restant (si en pause), mode}
let tic = null, sonne = false;
// Les boutons ne sont réécrits que s'ils changent : réécrits à chaque tic (4 fois par seconde),
// un appui tombant entre deux réécritures se perdait.
function boutons(html) { const b = $("#min-boutons"); if (b.dataset.html !== html) { b.innerHTML = html; b.dataset.html = html; } }

function lancerRepos(nom, quoi, cible) {
  const duree = reposDe(nom);
  minu = { nom, quoi, cible, duree, fin: Date.now() + duree * 1000, restant: null, mode: "repos" };
  sonne = false; garder(); ecranAllume();
}
function finExercice(nom) {
  minu = { nom, quoi: `${nom} : terminé ✓`, cible: "Repos libre le temps de changer de machine", duree: 0, fin: 0, restant: null, mode: "fin" };
  garder();
  setTimeout(() => { if (minu?.mode === "fin" && minu.nom === nom) arreterRepos(); }, 12000);
}
function garder() { ecrire("carnet:minuteur", minu); clearInterval(tic); tic = setInterval(majRepos, 250); majRepos(); }
function arreterRepos() { minu = null; localStorage.removeItem("carnet:minuteur"); clearInterval(tic); $("#minuteur").className = "minuteur"; }

function majRepos() {
  const el = $("#minuteur");
  if (!minu) { el.className = "minuteur"; return; }
  $("#min-quoi").textContent = minu.quoi;
  majEffort();
  $("#min-cible").textContent = minu.cible || "";
  if (minu.mode === "fin") {
    el.className = "minuteur actif";
    $("#chrono").textContent = "";
    $("#min-jauge").style.width = "0";
    boutons(`<button data-min="repos2" class="fort">Repos 2:00</button><button data-min="repos1">1:30</button><span></span><button data-min="stop">OK</button>`);
    return;
  }
  const reste = minu.restant ?? (minu.fin - Date.now()) / 1000;
  const v = Math.round(Math.abs(reste));
  $("#chrono").textContent = `${reste < 0 ? "+" : ""}${Math.floor(v / 60)}:${String(v % 60).padStart(2, "0")}`;
  $("#min-jauge").style.width = `${Math.max(0, Math.min(100, 100 * (1 - reste / minu.duree)))}%`;
  el.className = `minuteur actif ${reste <= 0 ? "fini" : ""} ${minu.restant != null ? "pause" : ""}`;
  boutons(`<button data-min="pause">${minu.restant != null ? "▶ Reprendre" : "⏸ Pause"}</button>`
    + `<button data-min="-15">−15 s</button><button data-min="15">+15 s</button>`
    + `<button data-min="stop" class="${reste <= 0 ? "fort" : ""}">${reste <= 0 ? "Go" : "Passer"}</button>`);
  if (reste <= 0 && !sonne) {
    sonne = true;
    navigator.vibrate?.([300, 150, 300, 150, 300]);
    bip();
    // L'écran clignote aussi : en salle, le bip se perd dans la musique.
    const f = $("#flash"); f.classList.remove("on"); void f.offsetWidth; f.classList.add("on");
  }
}

function majEffort() {
  // « Il en restait combien ? » sous le minuteur, pour la série qui vient d'être faite. Facultatif :
  // la réserve affine la cible et la récupération ; sans réponse, la série compte comme difficile.
  const el = $("#min-effort"), ef = minu?.effort;
  const x = ef ? seanceDuJour().exos.find((e) => e.nom === ef.nom)?.series?.[ef.i] : null;
  const html = x ? `<span>Il en restait combien ?</span>${[0, 1, 2, 3, 4].map((k) =>
    `<button data-effort="${k}" class="${x.e === k ? "choisi" : ""}">${k === 4 ? "4+" : k}</button>`).join("")}` : "";
  if (el.dataset.html !== html) { el.innerHTML = html; el.dataset.html = html; }
}

function bip() {
  // Trois bips courts, si le téléphone n'est pas en silencieux (la vibration, elle, passe toujours).
  try {
    const ac = new (window.AudioContext || window.webkitAudioContext)();
    [[0, 880], [0.25, 880], [0.5, 1320]].forEach(([debut, freq]) => {
      const o = ac.createOscillator(), g = ac.createGain();
      o.frequency.value = freq;
      o.connect(g); g.connect(ac.destination);
      g.gain.setValueAtTime(0.25, ac.currentTime + debut);
      g.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + debut + 0.2);
      o.start(ac.currentTime + debut); o.stop(ac.currentTime + debut + 0.22);
    });
  } catch {}
}

$("#minuteur").addEventListener("click", (ev) => {
  const ef = ev.target.closest("[data-effort]");
  if (ef && minu?.effort) {
    const x = seanceDuJour().exos.find((e) => e.nom === minu.effort.nom)?.series?.[minu.effort.i];
    if (x) { x.e = Number(ef.dataset.effort); sauver(); dessiner(); }
    navigator.vibrate?.(20);
    return garder();
  }
  const b = ev.target.closest("[data-min]");
  if (!b || !minu) return;
  const a = b.dataset.min;
  if (a === "stop") return arreterRepos();
  if (a === "repos2" || a === "repos1") {
    minu = { ...minu, mode: "repos", quoi: `Repos avant l'exercice suivant`, cible: "", duree: a === "repos2" ? 120 : 90 };
    minu.fin = Date.now() + minu.duree * 1000; sonne = false;
  } else if (a === "pause") {
    if (minu.restant != null) { minu.fin = Date.now() + minu.restant * 1000; minu.restant = null; }
    else minu.restant = (minu.fin - Date.now()) / 1000;
  } else {
    const d = Number(a);
    if (minu.restant != null) minu.restant += d; else minu.fin += d * 1000;
    minu.duree = Math.max(15, minu.duree + d);
    if (minu.nom && minu.mode === "repos" && !minu.quoi.startsWith("Repos avant")) ecrire(`carnet:repos:${minu.nom}`, minu.duree);
    if ((minu.restant ?? (minu.fin - Date.now()) / 1000) > 0) sonne = false;
  }
  garder();
});

// L'écran reste allumé pendant la séance (sinon il se verrouille entre deux séries).
let verrou = null;
async function ecranAllume() {
  try { if (!verrou && "wakeLock" in navigator) { verrou = await navigator.wakeLock.request("screen"); verrou.addEventListener("release", () => (verrou = null)); } } catch {}
}

// ───────────────────────────────────────── démarrage

window.addEventListener("online", synchroniser);
document.addEventListener("visibilitychange", () => { if (!document.hidden) { charger(); if (minu) { garder(); ecranAllume(); } } });
if (minu) garder();
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js");
dessiner();
if (cle) charger();
