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
let saisie = {};                              // nom → {c, r, cran} en cours de réglage
let choisie = null;                           // [nom, index] de la série sélectionnée (pour la retirer)
let onglet = "seance";                        // « seance » ou « progres »
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
    if (e) { mieux = { jour: s.jour, series: e.series.map((x) => [x.c, x.r]), cran: e.cran }; break; }
  }
  const h = ctx?.historique?.[nom];
  if (h && h.jour < jour && (!mieux || h.jour > mieux.jour)) mieux = { jour: h.jour, series: h.series, cran: null };
  return mieux;
}

function cran(nom, derniere) {
  if (derniere?.cran) return derniere.cran;
  const r = ctx?.exercices?.find((x) => x.nom === nom)?.reglage || "";
  const m = r.match(/cran\s*(\S+)/i);
  return m ? m[1] : "";
}

function cible(series) {
  // Double progression, même règle que le panneau Santé : charge gardée tant que le schéma n'est
  // pas tenu à la charge la plus haute, puis charge suivante.
  const { series: n = 4, reps = 8 } = ctx?.schema || {};
  const charges = series.map((s) => s[0]).filter((c) => c != null);
  if (!charges.length) return null;
  const haut = Math.max(...charges);
  const aHaut = series.filter((s) => s[0] === haut).map((s) => s[1]);
  if (haut === 0) return { texte: `vise ${Math.max(...aHaut) + 1} à la première série`, c: 0, r: Math.max(...aHaut) + 1 };
  if (aHaut.length >= n && Math.min(...aHaut) >= reps)
    return { texte: `${n}×${reps} tenu → charge suivante, vise ${n}×6-7`, c: haut, r: 6, monte: true };
  if (aHaut.length < n) return { texte: `reste à ${kg(haut)} : vise ${n} séries`, c: haut, r: reps };
  const vise = [...aHaut].sort((a, b) => b - a).slice(0, n);
  vise[vise.length - 1] = Math.min(reps, vise[vise.length - 1] + 1);
  return { texte: `reste à ${kg(haut)} : vise ${vise.join(", ")}`, c: haut, r: vise[vise.length - 1] };
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
  if (ctx?.jambes_depuis != null && s.type !== "legs" && ctx.jambes_depuis > 5)
    h += `<div class="sous alerte">Jambes : dernière séance il y a ${ctx.jambes_depuis} jours.</div>`;

  for (const nom of exosAffiches(s)) {
    const e = s.exos.find((x) => x.nom === nom);
    const faites = e?.series || [];
    const der = derniereFois(nom);
    const ci = der ? cible(der.series) : null;
    const n = ctx?.schema?.series || 4;
    const st = saisie[nom] || (saisie[nom] = {
      c: faites.length ? faites[faites.length - 1].c : (ci?.c ?? der?.series?.[0]?.[0] ?? 20),
      r: faites.length ? faites[faites.length - 1].r : (ci?.r ?? ctx?.schema?.reps ?? 8),
      cran: e?.cran || cran(nom, der),
    });
    h += `<div class="carte exo ${ouvert === nom ? "ouvert" : ""} ${faites.length >= n ? "fait" : ""}" data-exo="${esc(nom)}">
      <h3 data-ouvrir="${esc(nom)}">${esc(nom)}<span class="n">${faites.length}/${n}</span></h3>`;
    if (der) h += `<div class="sous">${jj(der.jour)} : ${esc(formatSeries(der.series))}${st.cran ? ` · cran ${esc(st.cran)}` : ""}</div>`;
    else h += `<div class="sous">pas encore d'historique${st.cran ? ` · cran ${esc(st.cran)}` : ""}</div>`;
    if (ci) h += `<div class="cible ${ci.monte ? "monte" : ""}">→ ${esc(ci.texte)}</div>`;
    if (faites.length)
      h += `<div class="series">${faites.map((x, i) => `<span class="serie ${choisie?.[0] === nom && choisie[1] === i ? "choisie" : ""}" data-serie="${i}" data-nom="${esc(nom)}">${kg(x.c)}×${x.r}</span>`).join("")}</div>`;
    h += `<div class="saisie">
        <div class="rangee"><label>kg</label><button data-pas="-2.5">−2,5</button><button data-pas="-1">−1</button>
          <span class="val">${kg(st.c)}</span><button data-pas="1">+1</button><button data-pas="2.5">+2,5</button></div>
        <div class="rangee"><label>reps</label><button data-reps="-1">−</button><span class="val">${st.r}</span><button data-reps="1">+</button></div>
        <div class="rangee"><label>cran</label><input data-cran value="${esc(st.cran)}" inputmode="text" placeholder="—"></div>
        <button class="gros" data-valider>Série ${faites.length + 1} ✓</button>
        ${choisie?.[0] === nom ? `<button class="gros danger" data-retirer>Retirer ${kg(faites[choisie[1]]?.c)}×${faites[choisie[1]]?.r}</button>` : ""}
      </div></div>`;
  }
  h += `<button class="lien" id="ajouter">+ Ajouter un exercice</button>`;
  h += `<textarea id="note" placeholder="Note : sensations, épaule…">${esc(s.note)}</textarea>`;
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

  // Corps et récupération (résumés journaliers poussés par le PC).
  const J = ctx?.jours || [];
  const pt = (cle) => J.map((x) => [x.j, x[cle]]);
  const dern = J.filter((x) => x.vfc_bas).pop();
  const douleurs = (ctx?.douleurs || []).slice();
  for (const s of toutesSeances()) if (s.douleur != null) { const i = douleurs.findIndex((x) => x[0] === s.jour); if (i >= 0) douleurs.splice(i, 1); douleurs.push([s.jour, s.douleur]); }
  const pesees = (ctx?.pesees || []).slice();
  for (const s of toutesSeances()) if (s.poids) { const i = pesees.findIndex((x) => x[0] === s.jour); if (i >= 0) pesees.splice(i, 1); pesees.push([s.jour, s.poids]); }
  h += courbe("Douleur à l'épaule", douleurs, { bas: 0, haut: 10, refs: [2], relier: 14, couleur: "var(--rouge)", jours: 120, legende: "sous 2 : on peut remonter" });
  h += courbe("Poids", pesees, { relier: 60, jours: 180, fmt: (v) => `${String(Math.round(v * 10) / 10).replace(".", ",")}` });
  const cible = ctx?.cibles?.sommeil;
  h += courbe("Sommeil", pt("sommeil"), { refs: cible ? [cible] : [], fmt: (v) => `${Math.floor(v / 60)}h${String(Math.round(v % 60)).padStart(2, "0")}` });
  h += courbe("VFC (nuit)", pt("vfc"), { bande: dern ? [dern.vfc_bas, dern.vfc_haut] : null, couleur: "var(--vert)", legende: "ms, bande verte : ton habituel" });
  h += courbe("FC au repos", pt("fc"), { couleur: "var(--rouge)", legende: "bpm" });
  h += courbe("Heure de coucher", pt("coucher"), { fmt: (v) => { const t = Math.round(v) + 1080; return `${String(Math.floor(t / 60) % 24).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`; },
    couleur: "var(--violet)", legende: "plus c'est plat, plus c'est régulier" });
  const cr = (ctx?.courses || []).map((c) => [c[0], c[2] / c[1]]);
  if (cr.length) h += courbe("Course — allure", cr, { jours: 365, relier: 30, couleur: "var(--jaune)", ajuster: true,
    fmt: (v) => `${Math.floor(v)}'${String(Math.round((v % 1) * 60)).padStart(2, "0")}`, legende: "min/km, plus bas = plus rapide" });
  if (ctx?.genere) h += `<p class="sous">Données du PC du ${jj(ctx.genere)} à ${ctx.genere.slice(11, 16)}.</p>`;
  return h;
}

// ───────────────────────────────────────── les gestes

document.addEventListener("click", (ev) => {
  const t = ev.target.closest("button, h3, .serie");
  if (!t) return;
  const carte = t.closest("[data-exo]");
  const nom = carte?.dataset.exo;
  const s = seanceDuJour();
  if (t.dataset.onglet) {
    onglet = t.dataset.onglet; window.scrollTo(0, 0);
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
    s.type = t.dataset.type; ouvert = null; choisie = null; sauver();
  } else if (t.dataset.ouvrir != null) {
    ouvert = ouvert === nom ? null : nom; choisie = null;
  } else if (t.dataset.pas) {
    const st = saisie[nom];
    st.c = Math.max(0, Math.round((Number(st.c || 0) + Number(t.dataset.pas)) * 4) / 4);
  } else if (t.dataset.reps) {
    saisie[nom].r = Math.max(1, saisie[nom].r + Number(t.dataset.reps));
  } else if (t.hasAttribute("data-valider")) {
    const st = saisie[nom];
    let e = s.exos.find((x) => x.nom === nom);
    if (!e) { e = { nom, series: [], cran: "" }; s.exos.push(e); }
    e.series.push({ c: st.c, r: st.r });
    e.cran = st.cran || "";
    navigator.vibrate?.(30);
    sauver();
    lancerRepos();
  } else if (t.classList.contains("serie")) {
    const i = Number(t.dataset.serie);
    choisie = choisie?.[0] === t.dataset.nom && choisie[1] === i ? null : [t.dataset.nom, i];
    ouvert = t.dataset.nom;
  } else if (t.hasAttribute("data-retirer")) {
    const e = s.exos.find((x) => x.nom === choisie[0]);
    e.series.splice(choisie[1], 1);
    if (!e.series.length) s.exos = s.exos.filter((x) => x !== e);
    choisie = null; sauver();
  } else if (t.id === "ajouter") {
    ouvrirAjout(); return;
  } else if (t.dataset.repos != null) {
    const v = Number(t.dataset.repos);
    if (v === 0) arreterRepos(); else finRepos += v * 1000;
    return;
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
  if (ev.target.hasAttribute("data-cran")) {
    const nom = ev.target.closest("[data-exo]").dataset.exo;
    saisie[nom].cran = ev.target.value.trim();
  }
});

// Ajouter un exercice hors programme : la liste du PC, ou un nom libre (le PC le signalera).
function ouvrirAjout() {
  const dlg = $("#ajout"), champ = $("#cherche");
  const rendu = () => {
    const q = champ.value.trim().toLowerCase();
    const liste = (ctx?.exercices || []).filter((x) => !q || x.nom.toLowerCase().includes(q)
      || (x.groupe || "").includes(q));
    $("#choix").innerHTML = liste.map((x) => `<button data-choix="${esc(x.nom)}">${esc(x.nom)} <span>${esc(x.groupe)}</span></button>`).join("")
      + (q && !liste.some((x) => x.nom.toLowerCase() === q) ? `<button data-choix="${esc(champ.value.trim())}">+ « ${esc(champ.value.trim())} »</button>` : "");
  };
  champ.value = ""; rendu(); champ.oninput = rendu;
  dlg.showModal(); champ.focus();
}
$("#choix").addEventListener("click", (ev) => {
  const b = ev.target.closest("[data-choix]");
  if (!b) return;
  const s = seanceDuJour(), nom = b.dataset.choix;
  if (!s.exos.find((x) => x.nom === nom)) s.exos.push({ nom, series: [], cran: "" });
  ouvert = nom; $("#ajout").close(); sauver(); dessiner();
});
$("#fermer-ajout").addEventListener("click", () => $("#ajout").close());

// ───────────────────────────────────────── repos entre les séries

let finRepos = 0, tic = null;
function lancerRepos() {
  finRepos = Date.now() + (lire("carnet:repos", 90)) * 1000;
  $("#repos").classList.add("actif"); $("#repos").classList.remove("fini");
  clearInterval(tic); tic = setInterval(majRepos, 250); majRepos();
}
function majRepos() {
  const reste = Math.round((finRepos - Date.now()) / 1000);
  const v = Math.abs(reste);
  $("#chrono").textContent = `${reste < 0 ? "+" : ""}${Math.floor(v / 60)}:${String(v % 60).padStart(2, "0")}`;
  if (reste <= 0 && !$("#repos").classList.contains("fini")) {
    $("#repos").classList.add("fini");
    navigator.vibrate?.([200, 100, 200]);
  }
}
function arreterRepos() { clearInterval(tic); $("#repos").classList.remove("actif"); }

// ───────────────────────────────────────── démarrage

window.addEventListener("online", synchroniser);
document.addEventListener("visibilitychange", () => { if (!document.hidden) charger(); });
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js");
dessiner();
if (cle) charger();
