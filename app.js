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

async function synchroniser() {
  if (!cle) return;
  let reste = 0;
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (!k?.startsWith("carnet:seance:")) continue;
    const x = lire(k);
    if (!x?.sale) continue;
    try {
      await api("carnet_ecrire", { p_jour: x.doc.jour, p_doc: x.doc });
      const actuel = lire(k);   // une série ajoutée pendant l'envoi garde la séance « à envoyer »
      if (actuel?.doc?.maj === x.doc.maj) ecrire(k, { doc: x.doc, sale: false });
      else reste++;
    } catch (e) {
      reste++;
      console.warn("envoi impossible", x.doc.jour, e.message);
      if (e.code === "28000") { etat("erreur", "clé refusée"); return; }
    }
  }
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
  for (const x of ctx?.pause || []) h += `<p class="pause">⏸ ${esc(x.nom)} en pause : ${esc(x.raison)}</p>`;
  if (!ctx) h += `<p class="sous">Le PC n'a pas encore envoyé ton programme : il le fera à sa prochaine synchro.</p>`;
  app.innerHTML = h;
}

function formatSeries(series) {
  let prec, out = [];
  for (const [c, r] of series) { out.push(c !== prec ? `${kg(c)}×${r}` : String(r)); prec = c; }
  return out.join(", ");
}

// ───────────────────────────────────────── les gestes

document.addEventListener("click", (ev) => {
  const t = ev.target.closest("button, h3, .serie");
  if (!t) return;
  const carte = t.closest("[data-exo]");
  const nom = carte?.dataset.exo;
  const s = seanceDuJour();
  if (t.dataset.type) {
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
