/* Cerca Casa — app di Elisa per la ricerca casa */
'use strict';

// SHA-256 del PIN (mai in chiaro nel codice: il repo è pubblico)
const PIN_HASH = '7463007726b9b4912187d8a4938ba975dbe7f28ce68b7aa9c0ac211ffa4b9b50';
const LS_KEY = 'cercacasa_v1';
const UNLOCK_KEY = 'cercacasa_unlocked';
// La sessione dura 30 giorni e si rinnova a ogni apertura: sessionStorage
// non bastava, iOS lo svuota ogni volta che chiude la PWA e il PIN tornava
// a ogni riapertura.
const DURATA_SESSIONE = 30 * 24 * 60 * 60 * 1000;

function sessioneValida() {
  const t = Number(localStorage.getItem(UNLOCK_KEY) || 0);
  return t > 0 && (Date.now() - t) < DURATA_SESSIONE;
}
function rinnovaSessione() {
  localStorage.setItem(UNLOCK_KEY, String(Date.now()));
}
function giorniSessioneRimasti() {
  const t = Number(localStorage.getItem(UNLOCK_KEY) || 0);
  if (!t) return 0;
  return Math.max(0, Math.ceil((DURATA_SESSIONE - (Date.now() - t)) / 86400000));
}

const STATI = {
  'da-valutare': 'Da valutare',
  'contattata': 'Contattata',
  'visita': 'Visita fissata',
  'visitata': 'Visitata',
  'preferita': '⭐ Preferita',
  'scartata': 'Scartata',
};

// Il verdetto dopo una visita. Tre soli esiti: di più non servono, e "in
// forse" è quello che capita più spesso quando si esce da una casa.
const ESITI = {
  promossa: '✅ Promossa',
  forse: '🤔 In forse',
  bocciata: '❌ Bocciata',
};
// Il verdetto della visita è anche lo stato della casa: tenerli separati
// vorrebbe dire aggiornare due volte la stessa cosa e dimenticarsene una.
const STATO_DA_ESITO = { promossa: 'preferita', forse: 'visitata', bocciata: 'scartata' };

// ---------- Portali immobiliari ----------
function slug(z) {
  return z.trim().toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-');
}
const enc = encodeURIComponent;

const PORTALS = [
  { name: 'Immobiliare.it', host: 'immobiliare.it', desc: 'Il portale più grande in Italia',
    url: (z, c) => `https://www.immobiliare.it/${c === 'affitto' ? 'affitto' : 'vendita'}-case/${slug(z)}/` },
  { name: 'Idealista', host: 'idealista.it', desc: 'Annunci e trend di prezzo',
    url: (z, c) => `https://www.idealista.it/${c === 'affitto' ? 'affitto' : 'vendita'}-case/${slug(z)}/` },
  { name: 'Casa.it', host: 'casa.it', desc: 'Annunci di agenzie e privati',
    url: (z, c) => `https://www.casa.it/${c === 'affitto' ? 'affitto' : 'vendita'}/residenziale/${slug(z)}` },
  { name: 'Subito.it', host: 'subito.it', desc: 'Tanti annunci di privati',
    url: (z, c) => `https://www.subito.it/annunci-italia/${c === 'affitto' ? 'affitto' : 'vendita'}/appartamenti/?q=${enc(z)}` },
  { name: 'Wikicasa', host: 'wikicasa.it', desc: 'Portale delle agenzie italiane',
    url: (z, c) => `https://www.wikicasa.it/${c === 'affitto' ? 'affitto' : 'vendita'}/case/${slug(z)}/` },
  { name: 'Trovit Case', host: 'trovit.it', desc: 'Aggregatore: cerca su più siti insieme',
    url: (z, c) => `https://case.trovit.it/index.php/cod.search_homes/what_d.${enc(z + ' ' + (c === 'affitto' ? 'affitto' : 'vendita'))}` },
  { name: 'Bakeca', host: 'bakeca.it', desc: 'Annunci locali (ricerca via Google)',
    url: (z, c) => `https://www.google.com/search?q=${enc(`site:bakeca.it case ${c} ${z}`)}` },
  { name: 'Google', host: '', desc: 'Ricerca generale, trova anche i siti minori',
    url: (z, c) => `https://www.google.com/search?q=${enc(`case ${c === 'affitto' ? 'in affitto' : 'in vendita'} ${z}`)}` },
];

const AGENZIE = [
  ['Tecnocasa', 'https://www.tecnocasa.it'],
  ['Gabetti', 'https://www.gabetti.it'],
  ['RE/MAX', 'https://www.remax.it'],
  ['Tempocasa', 'https://www.tempocasa.it'],
  ['Grimaldi', 'https://www.grimaldi.net'],
  ['Toscano', 'https://www.toscano.it'],
];

const SITI_OPZIONI = ['Immobiliare.it', 'Idealista', 'Casa.it', 'Subito.it', 'Wikicasa', 'Bakeca', 'Agenzia', 'Altro'];

// ---------- Stato ----------
let state = { houses: [], visite: [], extraZones: [], contract: 'vendita', zoneFilter: '' };

function load() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) state = Object.assign(state, JSON.parse(raw));
  } catch (e) { /* dati corrotti: si riparte vuoti */ }
  if (!Array.isArray(state.visite)) state.visite = [];   // backup di prima delle visite
}
function save() {
  localStorage.setItem(LS_KEY, JSON.stringify({
    houses: state.houses, visite: state.visite,
    extraZones: state.extraZones, contract: state.contract,
  }));
}

function zonesList() {
  const set = new Set(state.extraZones);
  state.houses.forEach(h => h.zona && set.add(h.zona));
  return [...set].sort((a, b) => a.localeCompare(b, 'it'));
}

// ---------- Utility ----------
const $ = sel => document.querySelector(sel);
function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}
// ---------- PIN ----------
async function sha256(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

function unlock() {
  $('#lock-screen').classList.add('hidden');
  $('#app').classList.remove('hidden');
  rinnovaSessione();
  renderAll();
  loadAnnunci();
  controllaHelper();
}

$('#pin-form').addEventListener('submit', async e => {
  e.preventDefault();
  const val = $('#pin-input').value;
  const hash = await sha256(val);
  if (hash === PIN_HASH) {
    $('#pin-error').classList.add('hidden');
    unlock();
  } else {
    $('#pin-error').classList.remove('hidden');
    $('#pin-input').value = '';
    $('#pin-input').focus();
  }
});

// ---------- Navigazione ----------
document.querySelectorAll('.nav-btn[data-tab]').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.nav-btn[data-tab]').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    btn.classList.add('active');
    $('#tab-' + btn.dataset.tab).classList.add('active');
    window.scrollTo(0, 0);
    if (btn.dataset.tab === 'annunci') loadAnnunci(true);
    if (btn.dataset.tab === 'case') renderHouses();
    if (btn.dataset.tab === 'visite') renderVisite();
    if (btn.dataset.tab === 'altro') { aggiornaInfoSessione(); riempiImpostazioni(); riempiNotifiche(); }
    else $('#header-count').textContent = '';
  });
});

// Cambiare scheda da codice passando dal bottone: così vale anche quello che
// la scheda fa aprendosi (ricaricare, riempire le impostazioni…).
function vaiA(tab) { document.querySelector(`.nav-btn[data-tab="${tab}"]`)?.click(); }

// ---------- Render: lista case ----------
function houseCard(h) {
  const card = el('div', 'card' + (h.stato === 'scartata' ? ' scartata' : ''));

  const top = el('div', 'card-top');
  top.append(el('div', 'card-title', h.titolo || (h.locali ? h.locali + ' locali' : 'Casa') + ' — ' + h.zona));
  top.append(el('span', 'stato-badge stato-' + h.stato, STATI[h.stato] || h.stato));
  card.append(top);

  if (h.prezzo) {
    const pr = el('div', 'card-price');
    pr.append(el('span', 'price', '€ ' + Number(h.prezzo).toLocaleString('it-IT')));
    if (h.mq) pr.append(el('span', 'price-mq', Math.round(h.prezzo / h.mq).toLocaleString('it-IT') + ' €/mq'));
    card.append(pr);
  }

  const meta = [];
  if (h.mq) meta.push('📐 ' + h.mq + ' mq');
  if (h.locali) meta.push('🚪 ' + h.locali + (h.locali == 1 ? ' locale' : ' locali'));
  if (h.bagni) meta.push('🛁 ' + h.bagni + (h.bagni == 1 ? ' bagno' : ' bagni'));
  if (h.piano) meta.push('🏢 piano ' + h.piano);
  if (meta.length) card.append(el('div', 'card-meta', meta.join('  ·  ')));

  if (h.indirizzo) {
    const addr = el('div', 'card-addr');
    const a = el('a', null, '📍 ' + h.indirizzo);
    a.href = 'https://www.google.com/maps/search/?api=1&query=' + enc(h.indirizzo);
    a.target = '_blank'; a.rel = 'noopener';
    addr.append(a);
    card.append(addr);
  }

  const badges = el('div', 'card-badges');
  badges.append(el('span', 'badge', h.zona));
  if (h.sito) badges.append(el('span', 'badge badge-sito', h.sito));
  card.append(badges);

  if (h.note) card.append(el('div', 'card-note', '📝 ' + h.note));

  // Se l'abbiamo già vista, il verdetto si legge da qui senza cambiare scheda
  const visita = visitaDiCasa(h.id);
  if (visita) {
    const conti = [];
    if (visita.pro?.length) conti.push(visita.pro.length + ' pro');
    if (visita.contro?.length) conti.push(visita.contro.length + ' contro');
    const riga = el('button', 'riga-visita esito-riga-' + visita.esito,
      (ESITI[visita.esito] || visita.esito)
      + (conti.length ? ' · ' + conti.join(', ') : ' · nessuna nota'));
    riga.title = 'Apri la visita';
    riga.addEventListener('click', () => apriVisita(visita.id));
    card.append(riga);
  }

  const actions = el('div', 'card-actions');
  if (h.link) {
    const a = el('a', 'primary', 'Annuncio ↗');
    a.href = h.link; a.target = '_blank'; a.rel = 'noopener';
    actions.append(a);
  }
  const vis = el('button', null, visita ? '👟 Visita' : '👟 Segna visita');
  vis.addEventListener('click', () => apriVisita(visita?.id || null, h));
  actions.append(vis);
  const edit = el('button', null, 'Modifica');
  edit.addEventListener('click', () => openDialog(h.id));
  actions.append(edit);
  const del = el('button', 'danger', 'Elimina');
  del.addEventListener('click', () => {
    if (confirm('Eliminare questa casa?')) {
      state.houses = state.houses.filter(x => x.id !== h.id);
      save(); renderAll();
    }
  });
  actions.append(del);
  card.append(actions);

  return card;
}

function renderHouses() {
  const list = $('#house-list');
  list.innerHTML = '';

  let houses = [...state.houses];
  if (state.zoneFilter) houses = houses.filter(h => h.zona === state.zoneFilter);
  const stato = $('#filter-stato').value;
  if (stato) houses = houses.filter(h => h.stato === stato);

  const sort = $('#sort-by').value;
  const num = v => Number(v) || 0;
  const eurmq = h => (h.prezzo && h.mq) ? h.prezzo / h.mq : Infinity;
  if (sort === 'prezzo-asc') houses.sort((a, b) => num(a.prezzo) - num(b.prezzo));
  else if (sort === 'prezzo-desc') houses.sort((a, b) => num(b.prezzo) - num(a.prezzo));
  else if (sort === 'mq-desc') houses.sort((a, b) => num(b.mq) - num(a.mq));
  else if (sort === 'eurmq-asc') houses.sort((a, b) => eurmq(a) - eurmq(b));
  else if (sort === 'recenti') houses.sort((a, b) => (b.created || 0) - (a.created || 0));
  else houses.sort((a, b) => a.zona.localeCompare(b.zona, 'it') || num(a.prezzo) - num(b.prezzo));

  // il conteggio in alto vale solo per la scheda Case: altrove sarebbe fuorviante
  if ($('#tab-case').classList.contains('active')) {
    $('#header-count').textContent = houses.length
      ? houses.length + (houses.length === 1 ? ' casa salvata' : ' case salvate') : '';
  }

  if (!houses.length) {
    const empty = el('div', 'empty-state');
    empty.append(el('div', 'big', '🏡'));
    empty.append(el('div', null, state.houses.length
      ? 'Nessuna casa con questi filtri.'
      : 'Ancora nessuna casa salvata. Tocca ＋ per aggiungere la prima!'));
    list.append(empty);
    return;
  }

  if (sort === 'zona') {
    let lastZona = null;
    houses.forEach(h => {
      if (h.zona !== lastZona) {
        lastZona = h.zona;
        const n = houses.filter(x => x.zona === h.zona).length;
        const head = el('div', 'zone-header', '📍 ' + h.zona + ' ');
        head.append(el('small', null, n + (n === 1 ? ' casa' : ' case')));
        list.append(head);
      }
      list.append(houseCard(h));
    });
  } else {
    houses.forEach(h => list.append(houseCard(h)));
  }
}

function renderZoneChips() {
  const wrap = $('#zone-chips');
  wrap.innerHTML = '';
  const zones = zonesList();
  const all = el('button', 'chip' + (state.zoneFilter ? '' : ' active'), 'Tutte');
  all.addEventListener('click', () => { state.zoneFilter = ''; renderAll(); });
  wrap.append(all);
  zones.forEach(z => {
    const c = el('button', 'chip' + (state.zoneFilter === z ? ' active' : ''), z);
    c.addEventListener('click', () => { state.zoneFilter = z; renderAll(); });
    wrap.append(c);
  });
}

// ---------- Visite ----------
// Una visita è quello che resta dopo essere entrati in una casa: due liste
// (cosa ci è piaciuto, cosa no) e un verdetto. Sta attaccata alla casa
// salvata quando c'è, ma può anche vivere da sola: capita di visitare
// qualcosa vista in giro, senza annuncio.
let visiteFiltro = '';

function visitaDiCasa(houseId) {
  return houseId ? state.visite.find(v => v.houseId === houseId) : null;
}

// Le più recenti in cima: la visita di ieri conta più di quella di marzo.
function visiteOrdinate() {
  return [...state.visite].sort((a, b) =>
    (b.data || '').localeCompare(a.data || '') || (b.created || 0) - (a.created || 0));
}

function dataItaliana(iso) {
  if (!iso) return '';
  const d = new Date(iso + 'T12:00:00');
  if (isNaN(d)) return iso;
  return d.toLocaleDateString('it-IT', { day: 'numeric', month: 'long', year: 'numeric' });
}

function elencoVoci(voci, cls, titolo) {
  const box = el('div', 'voci-lette ' + cls);
  box.append(el('div', 'voci-titolo', titolo));
  const ul = el('ul');
  voci.forEach(t => ul.append(el('li', null, t)));
  box.append(ul);
  return box;
}

function visitaCard(v) {
  const card = el('div', 'card visita-card esito-bordo-' + v.esito);

  const top = el('div', 'card-top');
  top.append(el('div', 'card-title', v.titolo));
  top.append(el('span', 'stato-badge esito-' + v.esito, ESITI[v.esito] || v.esito));
  card.append(top);

  const riga = [];
  if (v.data) riga.push('📅 ' + dataItaliana(v.data));
  if (v.prezzo) riga.push('€ ' + Number(v.prezzo).toLocaleString('it-IT'));
  if (riga.length) card.append(el('div', 'card-meta', riga.join('  ·  ')));

  if (v.indirizzo) {
    const addr = el('div', 'card-addr');
    const a = el('a', null, '📍 ' + v.indirizzo);
    a.href = 'https://www.google.com/maps/search/?api=1&query=' + enc(v.indirizzo);
    a.target = '_blank'; a.rel = 'noopener';
    addr.append(a);
    card.append(addr);
  }

  if (v.pro?.length) card.append(elencoVoci(v.pro, 'voci-pro', '👍 Ci è piaciuto'));
  if (v.contro?.length) card.append(elencoVoci(v.contro, 'voci-contro', '👎 Non ci è piaciuto'));
  if (!v.pro?.length && !v.contro?.length) {
    card.append(el('p', 'hint', 'Nessun pro e nessun contro segnato. Tocca Modifica per aggiungerli.'));
  }

  if (v.note) card.append(el('div', 'card-note', '📝 ' + v.note));

  const actions = el('div', 'card-actions');
  if (v.link) {
    const a = el('a', 'primary', 'Annuncio ↗');
    a.href = v.link; a.target = '_blank'; a.rel = 'noopener';
    actions.append(a);
  }
  const edit = el('button', null, 'Modifica');
  edit.addEventListener('click', () => apriVisita(v.id));
  actions.append(edit);
  const del = el('button', 'danger', 'Elimina');
  del.addEventListener('click', () => {
    if (!confirm('Eliminare questa visita? La casa resta tra le tue case.')) return;
    state.visite = state.visite.filter(x => x.id !== v.id);
    save(); renderAll();
  });
  actions.append(del);
  card.append(actions);

  return card;
}

function renderVisiteChips() {
  const wrap = $('#visite-chips');
  if (!wrap) return;
  wrap.innerHTML = '';
  const voci = [['', 'Tutte', state.visite.length]];
  Object.keys(ESITI).forEach(k => {
    voci.push([k, ESITI[k], state.visite.filter(v => v.esito === k).length]);
  });
  voci.forEach(([val, testo, n]) => {
    const c = el('button', 'chip' + (visiteFiltro === val ? ' active' : ''),
      testo + (n ? ' ' + n : ''));
    c.addEventListener('click', () => { visiteFiltro = val; renderVisite(); });
    wrap.append(c);
  });
}

function renderVisite() {
  const list = $('#visite-list');
  if (!list) return;
  renderVisiteChips();
  list.innerHTML = '';

  let visite = visiteOrdinate();
  if (visiteFiltro) visite = visite.filter(v => v.esito === visiteFiltro);

  const c = $('#visite-count');
  if (c) c.textContent = state.visite.length
    ? state.visite.length + (state.visite.length === 1 ? ' casa vista' : ' case viste') : '';

  if (!visite.length) {
    const empty = el('div', 'empty-state');
    empty.append(el('div', 'big', '👟'));
    empty.append(el('div', null, state.visite.length
      ? 'Nessuna visita con questo verdetto.'
      : 'Ancora nessuna visita. Dopo che hai visto una casa segna qui i pro, '
        + 'i contro e com\'è andata: fra dieci case non te lo ricordi più.'));
    list.append(empty);
    return;
  }

  visite.forEach(v => list.append(visitaCard(v)));
}

// --- Dialog visita ---
const visitaDialog = $('#visita-dialog');
let vPro = [];
let vContro = [];

function disegnaVoci(quale) {
  const voci = quale === 'pro' ? vPro : vContro;
  const box = $(quale === 'pro' ? '#v-pro-lista' : '#v-contro-lista');
  box.innerHTML = '';
  voci.forEach((t, i) => {
    const riga = el('div', 'voce voce-' + quale);
    riga.append(el('span', 'voce-testo', t));
    const x = el('button', 'voce-x', '✕');
    x.type = 'button';
    x.title = 'Togli';
    x.addEventListener('click', () => { voci.splice(i, 1); disegnaVoci(quale); });
    riga.append(x);
    box.append(riga);
  });
}

function aggiungiVoce(quale) {
  const inp = $(quale === 'pro' ? '#v-pro-input' : '#v-contro-input');
  const testo = inp.value.trim();
  if (!testo) return;
  (quale === 'pro' ? vPro : vContro).push(testo);
  inp.value = '';
  disegnaVoci(quale);
  inp.focus();
}

function segnaEsito(esito) {
  document.querySelectorAll('#v-esito button').forEach(b =>
    b.classList.toggle('active', b.dataset.esito === esito));
}
function esitoScelto() {
  return document.querySelector('#v-esito button.active')?.dataset.esito || 'forse';
}

// `id` per modificare una visita esistente, `casa` per partire da una casa
// salvata (i dati che già conosciamo si scrivono da soli).
function apriVisita(id, casa) {
  const v = id ? state.visite.find(x => x.id === id) : null;
  $('#visita-dialog-title').textContent = v ? 'Modifica visita' : 'Segna una visita';
  $('#v-id').value = v ? v.id : '';
  $('#v-house').value = v?.houseId || casa?.id || '';
  $('#v-titolo').value = v?.titolo
    || (casa ? (casa.titolo || [casa.zona, casa.indirizzo].filter(Boolean).join(' — ')) : '');
  $('#v-data').value = v?.data || new Date().toISOString().slice(0, 10);
  $('#v-prezzo').value = v?.prezzo ?? casa?.prezzo ?? '';
  $('#v-indirizzo').value = v?.indirizzo || casa?.indirizzo || '';
  $('#v-note').value = v?.note || '';
  vPro = [...(v?.pro || [])];
  vContro = [...(v?.contro || [])];
  $('#v-pro-input').value = '';
  $('#v-contro-input').value = '';
  disegnaVoci('pro');
  disegnaVoci('contro');
  segnaEsito(v?.esito || 'forse');
  visitaDialog.showModal();
}

document.querySelectorAll('#v-esito button').forEach(b =>
  b.addEventListener('click', () => segnaEsito(b.dataset.esito)));
$('#v-pro-add').addEventListener('click', () => aggiungiVoce('pro'));
$('#v-contro-add').addEventListener('click', () => aggiungiVoce('contro'));
// Invio aggiunge la voce invece di mandare avanti il modulo: si scrivono
// una dietro l'altra senza mai staccare le mani dalla tastiera.
['pro', 'contro'].forEach(quale => {
  $(quale === 'pro' ? '#v-pro-input' : '#v-contro-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); aggiungiVoce(quale); }
  });
});

$('#btn-add-visita').addEventListener('click', () => apriVisita(null, null));
$('#btn-visita-cancel').addEventListener('click', () => visitaDialog.close());

$('#visita-form').addEventListener('submit', e => {
  const titolo = $('#v-titolo').value.trim();
  if (!titolo) { e.preventDefault(); return; }
  // quello che sta ancora nella casella lo salvo lo stesso: sennò sparisce
  // e sembra che l'app se lo sia mangiato
  aggiungiVoce('pro');
  aggiungiVoce('contro');

  const id = $('#v-id').value || 'v' + Date.now();
  const esistente = state.visite.find(x => x.id === id);
  const houseId = $('#v-house').value || null;
  const casa = houseId ? state.houses.find(h => h.id === houseId) : null;
  const v = {
    id,
    created: esistente?.created || Date.now(),
    houseId,
    titolo,
    data: $('#v-data').value,
    prezzo: Number($('#v-prezzo').value) || null,
    indirizzo: $('#v-indirizzo').value.trim(),
    link: esistente?.link || casa?.link || '',
    esito: esitoScelto(),
    pro: [...vPro],
    contro: [...vContro],
    note: $('#v-note').value.trim(),
  };
  if (esistente) Object.assign(esistente, v);
  else state.visite.push(v);

  // il verdetto ricade sulla casa salvata, così le due schede si raccontano
  // la stessa storia
  if (casa) casa.stato = STATO_DA_ESITO[v.esito] || casa.stato;

  save(); renderAll();
});

// ---------- Render: annunci (scraper automatico) ----------
let annunciData = null;

// Annunci scartati col cestino: restano nascosti anche dopo un aggiornamento
// dei dati. Si possono sempre rivedere e ripristinare.
// Annunci mai visti prima: è la domanda vera di ogni mattina ("cosa c'è di
// nuovo?"), non "quali sono i 700 annunci". Gli id già visti stanno in memoria;
// i nuovi restano marcati per tutta la sessione, poi diventano visti.
const VISTI_KEY = 'cercacasa_id_visti';
let nuoviIds = new Set();
let soloNuovi = false;
let soloAste = false;

function calcolaNuovi(annunci) {
  let visti;
  try { visti = new Set(JSON.parse(localStorage.getItem(VISTI_KEY) || '[]')); }
  catch (e) { visti = new Set(); }
  const ids = annunci.map(a => a.id);
  // primo avvio: non è "tutto nuovo", sarebbe rumore
  nuoviIds = visti.size ? new Set(ids.filter(i => !visti.has(i))) : new Set();
  localStorage.setItem(VISTI_KEY, JSON.stringify(ids));
  return nuoviIds.size;
}

const SCARTATI_KEY = 'cercacasa_scartati';
let scartati = new Set();
try {
  const s = JSON.parse(localStorage.getItem(SCARTATI_KEY) || '[]');
  if (Array.isArray(s)) scartati = new Set(s);
} catch (e) { /* lista non valida: si riparte senza scarti */ }
let mostraScartati = false;

function salvaScartati() {
  localStorage.setItem(SCARTATI_KEY, JSON.stringify([...scartati]));
}

const TIPI_LABEL = {
  indipendente: '🏡 Indipendente',
  porzione: '🏘️ Porzione/schiera',
  appartamento: '🏢 Appartamento',
  rustico: '🌾 Rustico',
  terreno: '📐 Terreno',
  altro: '❓ Altro',
};

// ---------- Distanza dai punti di riferimento ----------
// Due riferimenti indipendenti, mostrabili insieme: il lavoro (predefinito
// Perfect Pack, modificabile) e la posizione attuale (GPS). Distanza in linea
// d'aria (haversine) calcolata nel browser.
const LAVORO_DEFAULT = {
  lat: 44.051612, lon: 12.520371, nome: 'Perfect Pack',
  completo: 'Via Borghetto 4, 47923 Rimini',
};
let mostraLavoro = true;       // mostra la distanza dal lavoro (default sì)
let mostraGps = false;         // mostra la distanza dalla posizione attuale
let posGps = null;             // {lat, lon} posizione attuale
let posGpsNome = '';           // dove ti ha localizzato (reverse geocoding)
let posLavoro = LAVORO_DEFAULT; // {lat, lon, nome} salvata o predefinita
let posCasa = null;            // dove abita adesso (impostabile)
let mostraCasa = false;
try {
  const c = JSON.parse(localStorage.getItem('cercacasa_casa') || 'null');
  if (c && c.lat) { posCasa = c; mostraCasa = true; }
} catch (e) { /* nessuna casa impostata */ }
try {
  const l = JSON.parse(localStorage.getItem('cercacasa_lavoro') || 'null');
  if (l && l.lat) posLavoro = riparaLavoro(l);
} catch (e) { /* si usa il lavoro predefinito */ }

// Ripara i lavori salvati con la vecchia versione: il nome veniva preso dalla
// prima parte dell'indirizzo trovato, che quando c'è il civico è il numero
// ("4"). Chi ha già salvato si ritroverebbe "💼 4" per sempre.
function riparaLavoro(l) {
  const nome = (l.nome || '').trim();
  const buono = nome && !/^\d+$/.test(nome) && /[a-zA-Zàèéìòù]/.test(nome);
  if (buono) return l;

  const vicinoAlDefault =
    Math.abs(l.lat - LAVORO_DEFAULT.lat) < 0.002 &&
    Math.abs(l.lon - LAVORO_DEFAULT.lon) < 0.002;
  if (vicinoAlDefault) {
    l.nome = LAVORO_DEFAULT.nome;
    l.completo = l.completo || LAVORO_DEFAULT.completo;
  } else {
    // ricavo un nome sensato dall'indirizzo completo, saltando il civico
    const pezzi = (l.completo || '').split(',').map(x => x.trim())
      .filter(x => x && !/^\d+$/.test(x));
    l.nome = pezzi.slice(0, 2).join(', ') || 'Lavoro';
  }
  localStorage.setItem('cercacasa_lavoro', JSON.stringify(l));
  return l;
}

function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371, rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad, dLon = (lon2 - lon1) * rad;
  const s = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.asin(Math.sqrt(s));
}

const fmtKm = km => (km < 10 ? km.toFixed(1) : Math.round(km)) + ' km';

function distKmDa(p, a) {
  if (!p || a.lat == null || a.lon == null) return null;
  return haversineKm(p.lat, p.lon, a.lat, a.lon);
}

// Distanza per ordinare/filtrare: usa la strada quando è già stata calcolata,
// altrimenti la linea d'aria (buona approssimazione per mettere in ordine).
function distanzaKm(a) {
  const p = (mostraGps && posGps) ? posGps
    : (mostraLavoro && posLavoro) ? posLavoro
    : (mostraCasa ? posCasa : null);
  if (!p) return null;
  const s = cacheStrada.get(chiaveStrada(p, a));
  return s ? s.km : distKmDa(p, a);
}

// ---- Distanze su strada (OSRM) --------------------------------------------
// In linea d'aria si sottostima del 30-60%: Cesena "24 km" sono 37 km reali.
// Si chiede il percorso vero solo per gli annunci che stai guardando.
const cacheStrada = new Map();          // "latRif,lonRif>idAnnuncio" → {km,min}
const chiaveStrada = (p, a) => `${p.lat.toFixed(4)},${p.lon.toFixed(4)}>${a.id}`;

async function calcolaStrade(p, annunci) {
  const daFare = annunci.filter(a => a.lat != null && !cacheStrada.has(chiaveStrada(p, a)));
  for (let i = 0; i < daFare.length; i += 80) {
    const blocco = daFare.slice(i, i + 80);
    const coords = `${p.lon},${p.lat};` + blocco.map(a => `${a.lon},${a.lat}`).join(';');
    const dest = blocco.map((_, n) => n + 1).join(';');
    try {
      const r = await fetch(`https://router.project-osrm.org/table/v1/driving/${coords}` +
        `?sources=0&destinations=${dest}&annotations=distance,duration`);
      const j = await r.json();
      blocco.forEach((a, n) => {
        const km = j.distances?.[0]?.[n], sec = j.durations?.[0]?.[n];
        if (km != null && sec != null) {
          cacheStrada.set(chiaveStrada(p, a), { km: km / 1000, min: Math.round(sec / 60) });
        }
      });
    } catch (e) { return false; }   // rete assente: si resta sulla linea d'aria
  }
  return true;
}

// Etichette distanza: strada vera se disponibile, altrimenti linea d'aria
// (marcata "in linea d'aria" per non ingannare). La tilde segnala che
// l'annuncio non dà l'indirizzo esatto e si usa il centro del comune.
function etichetteDistanza(a) {
  const out = [];
  const circa = a.pos === 'comune' ? '~' : '';
  const perRif = (p, icona) => {
    if (!p) return;
    const s = cacheStrada.get(chiaveStrada(p, a));
    if (s) { out.push(`${icona} ${circa}${fmtKm(s.km)} · ${s.min} min`); return; }
    const km = distKmDa(p, a);
    if (km != null) out.push(`${icona} ${circa}${fmtKm(km)}`);
  };
  if (mostraCasa) perRif(posCasa, '🏠');
  if (mostraLavoro) perRif(posLavoro, '💼');
  if (mostraGps) perRif(posGps, '📍');
  return out;
}

let scaricatoIl = 0;
const VALIDITA_DATI = 5 * 60 * 1000; // riscarica al massimo ogni 5 minuti

async function loadAnnunci(refetch) {
  const scaduto = Date.now() - scaricatoIl > VALIDITA_DATI;
  if (!annunciData || (refetch && scaduto)) {
    try {
      const res = await fetch('data/annunci.json', { cache: 'no-store' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      annunciData = await res.json();
      scaricatoIl = Date.now();
      calcolaNuovi(annunciData.annunci || []);
      popolaFonti();
      costruisciCaratChips();
      ripristinaFiltri();
      costruisciTipoChips();
    } catch (e) {
      if (!annunciData) annunciData = { errore: String(e) };
    }
  }
  renderAnnunci();
}

function popolaSelect(sel, valori, primaVoce) {
  const attuale = sel.value;
  sel.innerHTML = '';
  const prima = document.createElement('option');
  prima.value = ''; prima.textContent = primaVoce;
  sel.append(prima);
  valori.forEach(v => {
    const o = document.createElement('option');
    o.value = v; o.textContent = v;
    sel.append(o);
  });
  if (valori.includes(attuale)) sel.value = attuale;
}

function popolaFonti() {
  const ann = annunciData.annunci || [];
  popolaSelect($('#annunci-fonte'),
    [...new Set(ann.map(a => a.fonte))].sort(), 'Tutte le fonti');
  costruisciComuneChips();
}

// Comuni e località insieme: 30 comuni e 76 frazioni sono troppi per una
// distesa di chip, quindi si filtrano scrivendo. Le scelte restano sempre
// in cima, anche quando la ricerca le escluderebbe.
let comuniRichiesti = new Set();
const LUOGHI_MOSTRATI = 24;

function luoghiDisponibili() {
  const conta = new Map();
  (annunciData.annunci || []).forEach(a => {
    [a.comune, a.quartiere].filter(Boolean).forEach(v => conta.set(v, (conta.get(v) || 0) + 1));
  });
  return [...conta.entries()].sort((x, y) => y[1] - x[1]);
}

function costruisciComuneChips() {
  const box = $('#comune-chips');
  if (!box) return;
  const cerca = senzaAccenti(($('#comune-cerca')?.value || '').trim());
  const tutti = luoghiDisponibili();
  const scelti = tutti.filter(([n]) => comuniRichiesti.has(n));
  const resto = tutti.filter(([n]) => !comuniRichiesti.has(n)
    && (!cerca || senzaAccenti(n).includes(cerca)));

  box.innerHTML = '';
  const disegna = ([nome, n]) => {
    const attivo = comuniRichiesti.has(nome);
    const c = el('button', 'chip' + (attivo ? ' active' : ''), `${nome} ${n}`);
    c.addEventListener('click', () => {
      attivo ? comuniRichiesti.delete(nome) : comuniRichiesti.add(nome);
      costruisciComuneChips();
      // aggiornaVista() sa da sé se aggiornare il contatore del pannello
      // filtri (aperto) o ridisegnare la lista (chiuso)
      aggiornaVista(); salvaFiltri();
    });
    box.append(c);
  };
  scelti.forEach(disegna);
  resto.slice(0, LUOGHI_MOSTRATI).forEach(disegna);

  const nascosti = resto.length - LUOGHI_MOSTRATI;
  if (nascosti > 0) {
    box.append(el('span', 'hint chip-nota',
      `…e altri ${nascosti}: scrivi sopra per trovarli.`));
  } else if (!scelti.length && !resto.length) {
    box.append(el('span', 'hint chip-nota', 'Nessun luogo con questo nome.'));
  }
}

// Trovit dà titoli generici ("Appartamento in vendita a Forlì FC"): li
// arricchisco con i dati che ho, così la card dice qualcosa di utile.
const RE_TITOLO_VAGO = /^(annuncio|casa|appartamento|villa|villetta|rustico|casale)$|in vendita a .+ fc$|^vendita /i;

const NOME_TIPO = {
  indipendente: 'Casa indipendente', porzione: 'Porzione / schiera',
  appartamento: 'Appartamento', rustico: 'Rustico', terreno: 'Terreno',
  altro: 'Immobile',
};

function titoloUtile(a) {
  const t = (a.titolo || '').trim();
  if (!RE_TITOLO_VAGO.test(t)) return t;
  const pezzi = [NOME_TIPO[a.tipo] || 'Immobile'];
  if (a.mq) pezzi.push(a.mq + ' mq');
  if (a.locali) pezzi.push(a.locali + (a.locali == 1 ? ' locale' : ' locali'));
  const dove = a.quartiere || a.comune;
  return pezzi.join(', ') + (dove ? ' — ' + dove : '');
}

// Copia senza await, così il "tocco" resta valido e il link si apre lo stesso.
// Il vecchio Safari non ha navigator.clipboard: ripiego sulla textarea.
function copiaNegliAppunti(testo) {
  try {
    if (navigator.clipboard) { navigator.clipboard.writeText(testo); return; }
  } catch (e) { /* si prova col metodo vecchio */ }
  const ta = document.createElement('textarea');
  ta.value = testo;
  ta.style.cssText = 'position:fixed;opacity:0';
  document.body.append(ta);
  ta.select();
  try { document.execCommand('copy'); } catch (e) { /* niente da fare */ }
  ta.remove();
}

function testoMeta(a) {
  const meta = [];
  if (a.mq) meta.push('📐 ' + a.mq + ' mq');
  if (a.locali) meta.push('🚪 ' + a.locali + (a.locali == 1 ? ' locale' : ' locali'));
  if (a.bagni) meta.push('🛁 ' + a.bagni + (a.bagni == 1 ? ' bagno' : ' bagni'));
  if (a.piano) {
    // il dato a volte contiene già la parola "piano" ("piano terra", "1° piano")
    const p = String(a.piano).trim();
    meta.push('🏢 ' + (/piano/i.test(p) ? p : 'piano ' + p));
  }
  if (a.alt != null) meta.push('⛰️ ' + a.alt + ' m');
  etichetteDistanza(a).forEach(d => meta.push(d));
  return meta.join('  ·  ');
}

// Chiede a OSRM i percorsi per le card a schermo e riscrive la riga dati
async function aggiornaDistanzeVisibili() {
  const visibili = itemsFiltrati.slice(0, mostrati);
  const punti = [];
  if (mostraCasa && posCasa) punti.push(posCasa);
  if (mostraLavoro && posLavoro) punti.push(posLavoro);
  if (mostraGps && posGps) punti.push(posGps);
  if (!punti.length || !visibili.length) return;
  for (const p of punti) await calcolaStrade(p, visibili);
  visibili.forEach(a => {
    const riga = document.querySelector(`.riga-luogo[data-ann="${CSS.escape(a.id)}"]`);
    if (riga) scriviLuogo(riga, a);
  });
}

// Riga "dove + quanto dista": riscritta quando arrivano i percorsi su strada
// "3 giorni fa" leggibile. Distingue la data dichiarata dal portale da
// quella che ho dedotto io vedendolo comparire: sono cose diverse.
function etichettaData(a) {
  const iso = a.data || a.visto;
  if (!iso) return null;
  const g = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  if (isNaN(g) || g < 0) return null;
  const quando = g === 0 ? 'oggi' : g === 1 ? 'ieri'
    : g < 30 ? `${g} giorni fa`
    : g < 60 ? 'un mese fa'
    : `${Math.round(g / 30)} mesi fa`;
  return a.data ? 'pubblicato ' + quando : 'visto ' + quando;
}

function scriviLuogo(riga, a) {
  const luogo = [a.quartiere, a.comune].filter(Boolean).join(', ') || a.indirizzo || '';
  riga.innerHTML = '';
  riga.append(el('span', null, '📍 ' + luogo));
  const dist = etichetteDistanza(a);
  if (dist.length) riga.append(el('span', 'riga-dist', ' · ' + dist.join(' · ')));
}

function annuncioCard(a) {
  const card = el('div', 'card card-annuncio');

  // --- Foto a tutta larghezza con le due azioni in sovrimpressione ---
  const cornice = el('div', 'foto-cornice');
  if (a.foto) {
    const img = el('img', 'foto-grande');
    img.src = a.foto; img.alt = ''; img.loading = 'lazy';
    img.addEventListener('error', () => { cornice.classList.add('senza-foto'); img.remove(); });
    cornice.append(img);
  } else {
    cornice.classList.add('senza-foto');
  }

  const cestino = el('button', 'azione-foto a-sinistra', mostraScartati ? '↩︎' : '🗑️');
  cestino.title = mostraScartati ? 'Rimetti in lista' : 'Non mi interessa';
  cestino.addEventListener('click', e => {
    e.stopPropagation();
    if (mostraScartati) {
      scartati.delete(a.id); salvaScartati(); card.remove(); aggiornaContaFiltri();
      if (!scartati.size) { mostraScartati = false; renderAnnunci(); }
      return;
    }
    scartati.add(a.id); salvaScartati(); card.remove();
    itemsFiltrati = itemsFiltrati.filter(x => x.id !== a.id);
    mostrati = Math.max(0, mostrati - 1);
    aggiornaContatoreLista(); aggiornaContaFiltri(); mostraAnnulla(a);
  });
  cornice.append(cestino);

  const giaSalvata = state.houses.some(h => h.link === a.url);
  const cuore = el('button', 'azione-foto a-destra' + (giaSalvata ? ' salvato' : ''),
    giaSalvata ? '♥' : '♡');
  cuore.title = giaSalvata ? 'Già tra le tue case' : 'Salva tra le tue case';
  cuore.disabled = giaSalvata;
  cuore.addEventListener('click', e => {
    e.stopPropagation();
    cuore.textContent = '♥'; cuore.classList.add('salvato'); cuore.disabled = true;
    state.houses.push({
      id: String(Date.now()), created: Date.now(), link: a.url, titolo: titoloUtile(a),
      zona: a.quartiere || a.comune || 'Da smistare', sito: a.fonte,
      indirizzo: [a.indirizzo, a.quartiere, a.comune].filter(Boolean).join(', '),
      prezzo: a.prezzo, mq: a.mq, locali: a.locali, bagni: a.bagni,
      piano: a.piano || '', stato: 'da-valutare', note: '',
    });
    save(); renderZoneChips(); renderHouses(); renderZoneManage(); aggiornaBadgeCase();
  });
  cornice.append(cuore);

  // un solo cartellino, per ordine di importanza
  const avviso = a.avviso ? '⚠️ Attenzione'
    : (a.asta ? '⚖️ Asta' : (nuoviIds.has(a.id) ? '🆕 Nuovo' : null));
  if (avviso) {
    const cl = a.avviso ? ' targhetta-avviso' : (avviso.includes('Nuovo') ? ' targhetta-nuovo' : '');
    cornice.append(el('span', 'targhetta' + cl, avviso));
  }
  card.append(cornice);

  // --- Corpo: quattro righe, niente di più ---
  const corpo = el('div', 'card-corpo');

  const rigaPrezzo = el('div', 'riga-prezzo');
  rigaPrezzo.append(el('span', 'price', a.prezzo ? '€ ' + a.prezzo.toLocaleString('it-IT') : 'Prezzo su richiesta'));
  if (a.prezzo && a.mq) {
    rigaPrezzo.append(el('span', 'price-mq', Math.round(a.prezzo / a.mq).toLocaleString('it-IT') + ' €/mq'));
  }
  corpo.append(rigaPrezzo);

  const fatti = [];
  if (a.mq) fatti.push(a.mq + ' mq');
  if (a.locali) fatti.push(a.locali + (a.locali == 1 ? ' locale' : ' locali'));
  if (a.bagni) fatti.push(a.bagni + (a.bagni == 1 ? ' bagno' : ' bagni'));
  fatti.push(NOME_TIPO[a.tipo] || 'Immobile');
  corpo.append(el('div', 'riga-fatti', fatti.join(' · ')));

  const rigaLuogo = el('div', 'riga-luogo');
  rigaLuogo.dataset.ann = a.id;
  scriviLuogo(rigaLuogo, a);
  corpo.append(rigaLuogo);

  const sotto = [a.fonte];
  const quando = etichettaData(a);
  if (quando) sotto.push(quando);
  if (a.pos === 'comune') sotto.push('indirizzo non indicato');
  if (a.fibra?.livello === 'ok') sotto.push('📶 fibra');
  const rigaFonte = el('div', 'riga-fonte', sotto.join(' · '));
  // gli annunci freschi si notano
  const gg = (a.data || a.visto)
    ? Math.floor((Date.now() - new Date(a.data || a.visto).getTime()) / 86400000) : 99;
  if (gg <= 3) rigaFonte.classList.add('fresco');
  corpo.append(rigaFonte);

  card.append(corpo);

  // tutta la card apre il dettaglio: prima il bersaglio era il 2% dell'area
  card.addEventListener('click', () => apriDettaglio(a));
  return card;
}

// Scheda di dettaglio: qui sta tutto quello che è stato tolto dalla card
function apriDettaglio(a) {
  const c = $('#dettaglio-corpo');
  c.innerHTML = '';

  if (a.foto) {
    const img = el('img', 'dett-foto');
    img.src = a.foto; img.alt = '';
    img.addEventListener('error', () => img.remove());
    c.append(img);
  }
  c.append(el('h2', 'dett-titolo', titoloUtile(a)));

  const pr = el('div', 'riga-prezzo');
  pr.append(el('span', 'price', a.prezzo ? '€ ' + a.prezzo.toLocaleString('it-IT') : 'Prezzo su richiesta'));
  if (a.prezzo && a.mq) pr.append(el('span', 'price-mq', Math.round(a.prezzo / a.mq).toLocaleString('it-IT') + ' €/mq'));
  c.append(pr);

  c.append(el('div', 'card-meta', testoMeta(a)));

  const luogo = [a.indirizzo, a.quartiere, a.comune].filter(Boolean).join(', ');
  if (luogo) {
    const addr = el('div', 'card-addr');
    const link = el('a', null, '📍 ' + luogo + ' — apri su Maps');
    link.href = 'https://www.google.com/maps/search/?api=1&query=' + enc(luogo);
    link.target = '_blank'; link.rel = 'noopener';
    addr.append(link);
    if (a.pos === 'comune') addr.append(el('span', 'pos-circa', ' · indirizzo non indicato'));
    c.append(addr);
  }

  const badges = el('div', 'card-badges');
  badges.append(el('span', 'badge badge-tipo tipo-' + a.tipo, TIPI_LABEL[a.tipo] || a.tipo));
  badges.append(el('span', 'badge badge-sito', a.fonte));
  if (a.asta) badges.append(el('span', 'badge badge-sito', '⚖️ Asta'));
  c.append(badges);

  if (a.avviso) c.append(el('div', 'card-avviso', '⚠️ ' + a.avviso));

  if ((a.carat || []).length) {
    const cw = el('div', 'card-carat');
    a.carat.forEach(k => cw.append(el('span', 'carat-tag', CARAT_LABEL[k] || k)));
    c.append(cw);
  }

  if (a.fibra) {
    const f = el('div', 'card-fibra fibra-' + a.fibra.livello);
    f.textContent = ({ ok: '📶', quasi: '📶', corso: '🚧', no: '🕓' }[a.fibra.livello] || '📶')
      + ' ' + a.fibra.testo + ' a ' + (a.comune || 'questo comune');
    c.append(f);
  }

  if (a.descr) c.append(el('p', 'dett-descr', a.descr));

  const azioni = el('div', 'card-actions');
  const vedi = el('a', 'primary', 'Apri annuncio ↗');
  vedi.href = a.url; vedi.target = '_blank'; vedi.rel = 'noopener';
  azioni.append(vedi);
  if (luogo) {
    const testoInd = [a.indirizzo, a.comune].filter(Boolean).join(', ') || luogo;
    const fibra = el('a', null, '📶 Verifica fibra');
    fibra.href = 'https://openfiber.it/verifica-copertura/';
    fibra.target = '_blank'; fibra.rel = 'noopener';
    fibra.addEventListener('click', () => {
      copiaNegliAppunti(testoInd);
      fibra.textContent = '📋 Copiato!';
      setTimeout(() => { fibra.textContent = '📶 Verifica fibra'; }, 2500);
    });
    azioni.append(fibra);
  }
  c.append(azioni);
  $('#dettaglio-dialog').showModal();
  c.scrollTop = 0;
}

$('#btn-chiudi-dettaglio').addEventListener('click', () => $('#dettaglio-dialog').close());

function aggiornaBadgeNuovi() {
  const b = document.querySelector('.nav-btn[data-tab="annunci"]');
  if (!b) return;
  let pallino = b.querySelector('.nav-pallino');
  if (nuoviIds.size && !pallino) {
    pallino = el('span', 'nav-pallino');
    b.append(pallino);
  } else if (!nuoviIds.size && pallino) {
    pallino.remove();
  }
}

function aggiornaBadgeCase() {
  const b = $('#nav-badge-case');
  if (!b) return;
  b.textContent = state.houses.length || '';
  b.classList.toggle('hidden', !state.houses.length);
}

// Applica tutti i filtri. `conArea` = false serve alla mappa: lì si vogliono
// vedere i pin anche fuori dall'area, per poterla ridisegnare.
function filtraAnnunci(conArea) {
  let items = [...(annunciData?.annunci || [])];
  const num = id => Number($(id).value) || 0;

  // gli scartati spariscono, salvo quando li stai rivedendo apposta
  items = mostraScartati
    ? items.filter(a => scartati.has(a.id))
    : items.filter(a => !scartati.has(a.id));

  if (zonaAttiva) items = items.filter(a => inZona(a, zonaAttiva));
  const fonte = $('#annunci-fonte').value;
  if (fonte) items = items.filter(a => a.fonte === fonte);
  if (tipiRichiesti.size) items = items.filter(a => tipiRichiesti.has(a.tipo));
  // un luogo scelto vale sia come comune sia come frazione
  if (comuniRichiesti.size) {
    items = items.filter(a => comuniRichiesti.has(a.comune) || comuniRichiesti.has(a.quartiere));
  }

  // I filtri numerici sono STRETTI: se un annuncio non ha il dato richiesto
  // (es. "prezzo su richiesta") viene escluso, altrimenti sembra che il filtro
  // non funzioni. L'altitudine fa eccezione: c'è quasi sempre.
  const prezzoMax = num('#annunci-prezzo-max');
  if (prezzoMax) items = items.filter(a => a.prezzo && a.prezzo <= prezzoMax);
  const prezzoMin = num('#annunci-prezzo-min');
  if (prezzoMin) items = items.filter(a => a.prezzo && a.prezzo >= prezzoMin);
  const mqMin = num('#annunci-mq-min');
  if (mqMin) items = items.filter(a => a.mq && a.mq >= mqMin);
  const eurmqMax = num('#annunci-eurmq-max');
  if (eurmqMax) items = items.filter(a => a.prezzo && a.mq && a.prezzo / a.mq <= eurmqMax);
  const localiMin = num('#annunci-locali-min');
  if (localiMin) items = items.filter(a => a.locali && a.locali >= localiMin);
  const bagniMin = num('#annunci-bagni-min');
  if (bagniMin) items = items.filter(a => a.bagni && a.bagni >= bagniMin);
  const altMax = num('#annunci-alt-max');
  if (altMax) items = items.filter(a => a.alt == null || a.alt <= altMax);
  const kmMax = num('#annunci-km-max');
  if (kmMax && (mostraGps && posGps || mostraLavoro && posLavoro || mostraCasa && posCasa)) {
    items = items.filter(a => { const d = distanzaKm(a); return d != null && d <= kmMax; });
  }
  const condizione = $('#annunci-condizione').value;
  if (condizione) items = items.filter(a => a.condizione === condizione);
  const aste = $('#annunci-aste').value;
  if (aste === 'no') items = items.filter(a => !a.asta);
  if (aste === 'solo') items = items.filter(a => a.asta);
  if ($('#annunci-no-centro').checked) items = items.filter(a => !a.centro);
  if ($('#annunci-con-prezzo').checked) items = items.filter(a => a.prezzo);
  if ($('#annunci-fibra-ok').checked) {
    items = items.filter(a => ['ok', 'quasi'].includes(a.fibra?.livello));
  }
  if (caratRichieste.size) {
    items = items.filter(a => [...caratRichieste].every(c => (a.carat || []).includes(c)));
  }
  if (soloNuovi) items = items.filter(a => nuoviIds.has(a.id));
  if (soloAste) items = items.filter(a => a.asta);
  if (conArea && areaPoligono) items = items.filter(a => dentroArea(a));

  const q = $('#annunci-q').value.trim().toLowerCase();
  if (q) {
    items = items.filter(a =>
      [a.titolo, a.quartiere, a.indirizzo, a.comune, a.descr]
        .filter(Boolean).join(' ').toLowerCase().includes(q));
  }
  return items;
}

// Avviso temporaneo in basso con la possibilità di annullare l'ultimo scarto
let timerAnnulla = null;
function mostraAnnulla(a) {
  let box = $('#annulla-box');
  if (!box) {
    box = el('div', 'annulla-box');
    box.id = 'annulla-box';
    document.body.append(box);
  }
  box.innerHTML = '';
  box.append(el('span', null, 'Annuncio nascosto'));
  const undo = el('button', null, 'Annulla');
  undo.addEventListener('click', () => {
    scartati.delete(a.id);
    salvaScartati();
    box.remove();
    clearTimeout(timerAnnulla);
    renderAnnunci();
  });
  box.append(undo);
  box.classList.add('visibile');
  clearTimeout(timerAnnulla);
  timerAnnulla = setTimeout(() => box.remove(), 5000);
}

function renderAnnunci() {
  const list = $('#annunci-list');
  const info = $('#annunci-updated');
  if (!list || !annunciData) return;
  list.innerHTML = '';

  if (annunciData.errore || !Array.isArray(annunciData.annunci)) {
    info.textContent = 'Annunci non ancora disponibili: lo scraper non ha ancora pubblicato i dati.';
    return;
  }

  let items = filtraAnnunci(true);
  aggiornaContaFiltri();
  aggiornaBadgeNuovi();

  const sort = $('#annunci-sort').value;
  const val = v => Number(v) || 0;
  const eurmq = a => (a.prezzo && a.mq) ? a.prezzo / a.mq : Infinity;
  if (sort === 'prezzo-asc') items.sort((a, b) => (val(a.prezzo) || Infinity) - (val(b.prezzo) || Infinity));
  else if (sort === 'prezzo-desc') items.sort((a, b) => val(b.prezzo) - val(a.prezzo));
  else if (sort === 'mq-desc') items.sort((a, b) => val(b.mq) - val(a.mq));
  else if (sort === 'eurmq-asc') items.sort((a, b) => eurmq(a) - eurmq(b));
  else if (sort === 'vicini') {
    // più vicini al riferimento attivo (posizione o lavoro), in km
    items.sort((a, b) => (distanzaKm(a) ?? 9999) - (distanzaKm(b) ?? 9999));
  } else if (sort === 'data') {
    const q = a => new Date(a.data || a.visto || 0).getTime();
    items.sort((a, b) => q(b) - q(a));
  } else {
    // "recenti": alterna le fonti (ognuna è già ordinata per data dal più nuovo)
    const perFonte = {};
    items.forEach(a => (perFonte[a.fonte] = perFonte[a.fonte] || []).push(a));
    const gruppi = Object.values(perFonte);
    items = [];
    for (let i = 0; gruppi.some(g => i < g.length); i++) {
      gruppi.forEach(g => { if (g[i]) items.push(g[i]); });
    }
  }

  // Portali che bloccano lo scraping: scorciatoie alla ricerca configurata
  const linksWrap = $('#annunci-links');
  linksWrap.innerHTML = '';
  const visti = new Set();
  (annunciData.ricerche || []).flatMap(r => r.linksEsterni || []).forEach(l => {
    if (visti.has(l.nome)) return;
    visti.add(l.nome);
    const link = el('a', null, l.nome + ' ↗');
    link.href = l.url; link.target = '_blank'; link.rel = 'noopener';
    linksWrap.append(link);
  });

  const quando = annunciData.updated
    ? new Date(annunciData.updated).toLocaleString('it-IT', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
    : '?';
  const errori = (annunciData.ricerche || []).flatMap(r => r.errori || []);
  const clf = annunciData.classificatore === 'regole' ? 'tipologie stimate' : 'tipologie AI';
  codaInfo = errori.length
    ? `⚠️ ${errori.length} fonte/i in errore`
    : `agg. ${quando}`;
  itemsFiltrati = items;
  aggiornaContatoreLista();

  if (!items.length) {
    const empty = el('div', 'empty-state');
    empty.append(el('div', 'big', mostraScartati ? '🗑️' : '📭'));
    empty.append(el('div', null, mostraScartati
      ? 'Non hai nascosto nessun annuncio.'
      : `Nessuno dei ${annunciData.annunci.length} annunci passa questi filtri.`));
    const azzera = el('button', 'btn btn-primary', mostraScartati ? '← Torna alla lista' : '↺ Azzera i filtri');
    azzera.style.marginTop = '14px';
    azzera.addEventListener('click', () => {
      if (mostraScartati) { mostraScartati = false; renderAnnunci(); } else $('#btn-azzera').click();
    });
    empty.append(azzera);
    list.append(empty);
    return;
  }

  // nella vista scartati offro il ripristino in blocco
  if (mostraScartati) {
    const tutti = el('button', 'btn btn-block btn-altri', '↩︎ Ripristina tutti gli annunci nascosti');
    tutti.addEventListener('click', () => {
      if (!confirm(`Rimettere in lista tutti i ${scartati.size} annunci nascosti?`)) return;
      scartati.clear(); salvaScartati(); mostraScartati = false; renderAnnunci();
    });
    list.append(tutti);
  }

  // Render a blocchi: centinaia di card insieme rendono l'app lenta sul telefono
  mostrati = Math.min(PAGINA, items.length);
  disegnaBlocco();
}

const PAGINA = 60;
let itemsFiltrati = [];
let mostrati = 0;
let codaInfo = '';

// Riga in cima: quanti annunci stai vedendo ora (cambia anche col cestino)
function aggiornaContatoreLista() {
  const n = itemsFiltrati.length;
  $('#annunci-conteggio').textContent = mostraScartati
    ? `${n} nascosti`
    : `${n} ${n === 1 ? 'annuncio' : 'annunci'}`;
  $('#annunci-updated').textContent = mostraScartati ? 'col cestino' : codaInfo;
}

function disegnaBlocco() {
  const list = $('#annunci-list');
  const vecchio = $('#btn-altri-annunci');
  if (vecchio) vecchio.remove();

  const frammento = document.createDocumentFragment();
  for (let i = list.querySelectorAll('.card').length; i < mostrati; i++) {
    frammento.append(annuncioCard(itemsFiltrati[i]));
  }
  list.append(frammento);

  if (mostrati < itemsFiltrati.length) {
    const rimasti = itemsFiltrati.length - mostrati;
    const btn = el('button', 'btn btn-block btn-altri', `Mostra altri ${Math.min(PAGINA, rimasti)} (ne restano ${rimasti})`);
    btn.id = 'btn-altri-annunci';
    btn.addEventListener('click', () => {
      mostrati = Math.min(mostrati + PAGINA, itemsFiltrati.length);
      disegnaBlocco();
    });
    list.append(btn);
  }
  aggiornaDistanzeVisibili();
}

// ---------- Filtri: registrazione, conteggio, persistenza ----------
const CARAT_LABEL = {
  giardino: '🌳 Giardino', terrazzo: '🏖️ Terrazzo', balcone: '🪟 Balcone',
  garage: '🚗 Garage/posto auto', ascensore: '🛗 Ascensore',
  cantina: '📦 Cantina/taverna', piscina: '🏊 Piscina', camino: '🔥 Camino',
  arredato: '🛋️ Arredato', climatizzato: '❄️ Aria condizionata',
  panoramico: '🌅 Panoramico', fotovoltaico: '☀️ Fotovoltaico',
  fibra: '📶 Fibra ottica',
};
const FILTRI_ID = ['annunci-q', 'annunci-fonte',
  'annunci-prezzo-max', 'annunci-prezzo-min', 'annunci-mq-min', 'annunci-eurmq-max',
  'annunci-locali-min', 'annunci-bagni-min', 'annunci-alt-max', 'annunci-km-max',
  'annunci-condizione', 'annunci-aste'];

// etichette leggibili per la barra dei filtri attivi
const FILTRI_ETICHETTE = {
  'annunci-q': v => `“${v}”`,
  'annunci-fonte': v => v,
  'annunci-prezzo-max': v => '≤ €' + Number(v).toLocaleString('it-IT'),
  'annunci-prezzo-min': v => '≥ €' + Number(v).toLocaleString('it-IT'),
  'annunci-mq-min': v => '≥ ' + v + ' mq',
  'annunci-eurmq-max': v => '≤ ' + v + ' €/mq',
  'annunci-locali-min': v => '≥ ' + v + ' locali',
  'annunci-bagni-min': v => '≥ ' + v + ' bagni',
  'annunci-alt-max': v => ({ '100': '🏞️ Solo pianura', '300': '🌄 Pianura e collina' }[v] || v + ' m'),
  'annunci-km-max': v => '📍 entro ' + v + ' km',
  'annunci-condizione': v => ({ nuovo: '✨ Nuovo', ristrutturato: '🔨 Ristrutturato', 'da-ristrutturare': '🧱 Da ristrutturare' }[v] || v),
  'annunci-aste': v => ({ no: '🚫 No aste', solo: '⚖️ Solo aste' }[v] || v),
};
const FILTRI_KEY = 'cercacasa_filtri';
let caratRichieste = new Set();
let tipiRichiesti = new Set();   // più tipologie insieme
let zonaAttiva = '';

// Il campo di ricerca aspetta una pausa di digitazione: senza, ogni tasto
// ridisegnerebbe la lista intera.
let timerRicerca = null;
FILTRI_ID.forEach(id => {
  const e = $('#' + id);
  const ritardo = e.type === 'text' ? 250 : 0;
  e.addEventListener(e.tagName === 'SELECT' ? 'change' : 'input', () => {
    clearTimeout(timerRicerca);
    timerRicerca = setTimeout(() => {
      if ($('#filtri-dialog').open) { aggiornaContaRisultati(); salvaFiltri(); }
      else { renderAnnunci(); salvaFiltri(); }
    }, ritardo);
  });
});
// Scrivere qui restringe solo l'elenco dei luoghi: non è un filtro, quindi
// non tocca la lista degli annunci finché non scegli.
let timerLuoghi = null;
$('#comune-cerca')?.addEventListener('input', () => {
  clearTimeout(timerLuoghi);
  timerLuoghi = setTimeout(costruisciComuneChips, 200);
});

$('#annunci-sort').addEventListener('change', () => { renderAnnunci(); salvaFiltri(); });
$('#annunci-no-centro').addEventListener('change', () => { aggiornaVista(); salvaFiltri(); });
$('#annunci-con-prezzo').addEventListener('change', () => { aggiornaVista(); salvaFiltri(); });
$('#annunci-fibra-ok').addEventListener('change', () => { aggiornaVista(); salvaFiltri(); });

// ---------- Punti di riferimento per la distanza ----------
function aggiornaChipRif() {
  const cc = $('#chip-casa');
  if (cc) {
    cc.classList.toggle('hidden', !posCasa);
    cc.classList.toggle('active', mostraCasa);
    cc.textContent = '🏠 ' + (posCasa?.nome || 'Casa');
  }
  $('#chip-lavoro').classList.toggle('active', mostraLavoro);
  $('#chip-lavoro').textContent = '💼 ' + (posLavoro ? posLavoro.nome : 'Lavoro');
  const g = document.querySelector('.chip-rif[data-rif="gps"]');
  g.classList.toggle('active', mostraGps);
  // riga di conferma: dove ti ha localizzato il GPS / che indirizzo ha trovato
  const conf = $('#rif-conferma');
  const righe = [];
  if (mostraCasa && posCasa?.completo) {
    righe.push('🏠 Casa: ' + posCasa.completo.split(',').slice(0, 3)
      .map(x => x.trim()).filter(Boolean).join(', '));
  }
  if (mostraLavoro && posLavoro?.completo) {
    const via = posLavoro.completo.split(',').slice(0, 4)
      .map(s => s.trim()).filter(Boolean).join(', ');
    const nome = posLavoro.nome && posLavoro.nome !== via ? posLavoro.nome + ' — ' : '';
    righe.push('💼 Lavoro: ' + nome + via + ' · sbagliato? tocca ✏️');
  }
  if (mostraGps && posGpsNome) {
    righe.push('📍 Sei vicino a: ' + posGpsNome + ' — non è giusto? tocca di nuovo 📍');
  }
  conf.textContent = righe.join('\n');
  conf.classList.toggle('hidden', !righe.length);
}

function ottieniPosizione() {
  return new Promise((risolvi, rifiuta) => {
    if (!navigator.geolocation) return rifiuta(new Error('geolocalizzazione non disponibile'));
    navigator.geolocation.getCurrentPosition(
      p => risolvi({ lat: p.coords.latitude, lon: p.coords.longitude, acc: p.coords.accuracy }),
      e => rifiuta(e),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 });
  });
}

async function geocodaIndirizzo(testo) {
  const url = 'https://nominatim.openstreetmap.org/search?format=json&limit=1&addressdetails=1'
    + '&countrycodes=it&q=' + encodeURIComponent(testo);
  const r = await fetch(url, { headers: { 'Accept-Language': 'it' } });
  const dati = await r.json();
  if (!dati.length) return null;
  const d = dati[0], ind = d.address || {};
  // Attenzione: display_name comincia col civico ("4, Via Borghetto, …"),
  // quindi split(',')[0] darebbe "4". Il nome si compone dai pezzi giusti.
  const via = ind.road || ind.pedestrian || ind.suburb || '';
  const citta = ind.city || ind.town || ind.village || ind.municipality || '';
  const nome = [via, citta].filter(Boolean).join(', ') || (d.display_name || testo).split(',')[0];
  return {
    lat: Number(d.lat), lon: Number(d.lon), nome,
    completo: d.display_name || testo,
  };
}

// Reverse geocoding: da coordinate al nome del luogo (per confermare il GPS)
async function nomeDaCoord(lat, lon) {
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=json&zoom=16&lat=${lat}&lon=${lon}`;
    const r = await fetch(url, { headers: { 'Accept-Language': 'it' } });
    const d = await r.json();
    const a = d.address || {};
    return [a.road, a.suburb || a.village || a.town || a.city, a.county]
      .filter(Boolean).slice(0, 2).join(', ') || 'posizione rilevata';
  } catch (e) { return 'posizione rilevata'; }
}

$('#chip-casa')?.addEventListener('click', () => {
  if (!posCasa) { alert('Prima imposta l\'indirizzo di casa in Altro → I miei indirizzi.'); return; }
  mostraCasa = !mostraCasa;
  aggiornaChipRif();
  renderAnnunci();
});

$('#chip-lavoro').addEventListener('click', () => {
  // se è già l'unico riferimento attivo, un tocco apre l'editor
  if (mostraLavoro && !mostraGps) { apriEditorLavoro(); return; }
  mostraLavoro = !mostraLavoro;
  aggiornaChipRif();
  renderAnnunci();
});
$('#btn-edit-lavoro').addEventListener('click', apriEditorLavoro);

document.querySelector('.chip-rif[data-rif="gps"]').addEventListener('click', async function () {
  if (mostraGps) { mostraGps = false; aggiornaChipRif(); renderAnnunci(); return; }
  this.textContent = '📍 Individuo…';
  try {
    posGps = await ottieniPosizione();
    posGpsNome = await nomeDaCoord(posGps.lat, posGps.lon);
    mostraGps = true;
  } catch (e) {
    alert('Non riesco a leggere la posizione: ' + (e.message || 'permesso negato'));
  }
  this.textContent = '📍 La mia posizione';
  aggiornaChipRif();
  renderAnnunci();
});

function apriEditorLavoro() {
  const box = $('#lavoro-edit');
  box.classList.remove('hidden');
  const inp = $('#lavoro-input');
  inp.value = posLavoro
    ? [posLavoro.nome, posLavoro.completo].filter(Boolean).join(', ')
    : '';
  inp.focus();
  inp.select();
}

async function salvaLavoro() {
  let testo = $('#lavoro-input').value.trim();
  if (!testo) return;
  // "Perfect Pack, Via Borghetto 4 Rimini" → etichetta + indirizzo da cercare.
  // Se scrivi solo l'indirizzo l'etichetta la ricava il geocoder.
  let etichetta = null;
  const pezzi = testo.split(',').map(x => x.trim()).filter(Boolean);
  if (pezzi.length > 1 && !/\d/.test(pezzi[0]) && !/^(via|viale|piazza|corso|largo|strada|vicolo|contrada|localit)/i.test(pezzi[0])) {
    etichetta = pezzi[0];
    testo = pezzi.slice(1).join(', ');
  }
  const btn = $('#btn-salva-lavoro');
  btn.disabled = true; btn.textContent = 'Cerco…';
  const p = await geocodaIndirizzo(testo).catch(() => null);
  btn.disabled = false; btn.textContent = 'Salva';
  if (!p) { alert('Indirizzo non trovato. Aggiungi la città, es. "Via Emilia 10, Cesena".'); return; }
  if (etichetta) p.nome = etichetta;
  posLavoro = p;
  localStorage.setItem('cercacasa_lavoro', JSON.stringify(p));
  mostraLavoro = true;
  $('#lavoro-edit').classList.add('hidden');
  aggiornaChipRif();
  renderAnnunci();
}

$('#btn-salva-lavoro').addEventListener('click', salvaLavoro);
$('#lavoro-input').addEventListener('keydown', e => { if (e.key === 'Enter') salvaLavoro(); });
aggiornaChipRif();

// --- Pannello filtri a schermo intero ---
let scrollPrimaDeiFiltri = 0;
$('#btn-filtri').addEventListener('click', () => {
  scrollPrimaDeiFiltri = window.scrollY;
  aggiornaContaRisultati();
  $('#filtri-dialog').showModal();
});
function chiudiFiltri() {
  $('#filtri-dialog').close();
  renderAnnunci();
  // torna dove eri: aprire i filtri non deve farti perdere il segno
  requestAnimationFrame(() => window.scrollTo(0, scrollPrimaDeiFiltri));
}
$('#btn-chiudi-filtri').addEventListener('click', chiudiFiltri);
$('#btn-applica-filtri').addEventListener('click', chiudiFiltri);

// Contatore vivo dentro il pannello: si vede l'effetto senza chiudere
function aggiornaContaRisultati() {
  const n = filtraAnnunci(true).length;
  $('#conta-risultati').textContent = n === 1 ? '1 annuncio' : `${n} annunci`;
  $('#btn-applica-filtri').disabled = false;
}

// --- Foglio ordinamento ---
$('#btn-ordina').addEventListener('click', () => $('#ordina-dialog').showModal());
$('#ordina-dialog').addEventListener('click', e => {
  if (e.target.id === 'ordina-dialog') $('#ordina-dialog').close();
});
$('#annunci-sort').addEventListener('change', () => $('#ordina-dialog').close());

// Zone di ricerca di Elisa: chip con il conteggio, così non escludono in
// silenzio. "Santa Maria Nuova" è una frazione di Bertinoro: sono due chip
// distinti, i numeri dicono la differenza.
const ZONE = [
  { id: '', nome: 'Ovunque' },
  { id: 'santa maria nuova', nome: 'Santa Maria Nuova' },
  { id: 'bertinoro', nome: 'Bertinoro' },
  { id: 'cesena', nome: 'Cesena' },
  { id: 'gambettola', nome: 'Gambettola' },
  { id: 'forli', nome: 'Forlì' },
];

const senzaAccenti = t => (t || '').toLowerCase()
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/'/g, '').trim();

// Un annuncio appartiene a una zona se lo dice il campo zona, il comune,
// il quartiere o l'indirizzo: il solo campo zona è vuoto su 194 annunci.
function inZona(a, z) {
  if (!z) return true;
  if (a.zona === z) return true;
  const dove = senzaAccenti([a.comune, a.quartiere, a.indirizzo].filter(Boolean).join(' '));
  return dove.includes(z);
}

function contaZona(z) {
  return (annunciData?.annunci || []).filter(a => !scartati.has(a.id) && inZona(a, z)).length;
}

function costruisciTipoChips() {
  const wrap = $('#tipo-chips');
  wrap.innerHTML = '';
  Object.entries(TIPI_LABEL).forEach(([k, label]) => {
    const n = (annunciData?.annunci || []).filter(a => a.tipo === k && !scartati.has(a.id)).length;
    if (!n) return;
    const c = el('button', 'chip' + (tipiRichiesti.has(k) ? ' active' : ''), `${label} ${n}`);
    c.addEventListener('click', () => {
      tipiRichiesti.has(k) ? tipiRichiesti.delete(k) : tipiRichiesti.add(k);
      c.classList.toggle('active');
      aggiornaVista(); salvaFiltri();
    });
    wrap.append(c);
  });
}

function costruisciCaratChips() {
  const wrap = $('#carat-chips');
  if (wrap.children.length) return;
  Object.entries(CARAT_LABEL).forEach(([k, label]) => {
    const c = el('button', 'chip' + (caratRichieste.has(k) ? ' active' : ''), label);
    c.addEventListener('click', () => {
      caratRichieste.has(k) ? caratRichieste.delete(k) : caratRichieste.add(k);
      c.classList.toggle('active');
      aggiornaVista(); salvaFiltri();
    });
    wrap.append(c);
  });
}

// Col pannello aperto basta aggiornare il numero: ridisegnare la lista
// sotto sarebbe lavoro sprecato e farebbe perdere la posizione.
function aggiornaVista() {
  if ($('#filtri-dialog').open) aggiornaContaRisultati();
  else renderAnnunci();
}

function aggiornaContaFiltri() {
  // Riga sempre visibile: prima i filtri accesi (si tolgono con un tocco),
  // poi le zone col loro conteggio. Non collassa mai: è l'unico accesso
  // agli annunci nascosti e all'area disegnata.
  const bar = $('#riga-chip');
  bar.innerHTML = '';
  let nFiltri = 0;

  const chip = (testo, rimuovi) => {
    nFiltri++;
    const c = el('button', 'attivo-chip', testo);
    c.append(el('span', 'attivo-x', '✕'));
    c.addEventListener('click', () => { rimuovi(); renderAnnunci(); salvaFiltri(); });
    bar.append(c);
  };

  if (nuoviIds.size && !mostraScartati) {
    const c = el('button', 'attivo-chip attivo-nuovi' + (soloNuovi ? ' acceso' : ''),
      `🆕 ${nuoviIds.size} nuovi`);
    c.addEventListener('click', () => { soloNuovi = !soloNuovi; renderAnnunci(); });
    bar.append(c);
  }
  // Quante aste sopravvivono ai filtri di adesso. Serve perché con
  // "indipendente" più una zona le aste sono zero, e senza dirlo sembra
  // che siano sparite dal portale.
  if (!mostraScartati) {
    const quante = filtraAnnunci(true).filter(a => a.asta).length;
    const totali = (annunciData?.annunci || []).filter(a => a.asta && !scartati.has(a.id)).length;
    if (quante || (totali && soloAste)) {
      const c = el('button', 'attivo-chip attivo-aste' + (soloAste ? ' acceso' : ''),
        `⚖️ ${quante} aste`);
      c.addEventListener('click', () => { soloAste = !soloAste; renderAnnunci(); });
      bar.append(c);
    } else if (totali) {
      const c = el('button', 'attivo-chip attivo-aste',
        `⚖️ ${totali} aste, nessuna coi filtri di adesso`);
      c.title = 'Tocca per vedere tutte le aste';
      c.addEventListener('click', () => {
        FILTRI_ID.forEach(id => { $('#' + id).value = ''; });
        tipiRichiesti.clear(); comuniRichiesti.clear(); caratRichieste.clear();
        zonaAttiva = ''; soloAste = true;
        costruisciTipoChips(); costruisciComuneChips(); salvaFiltri(); renderAnnunci();
      });
      bar.append(c);
    }
  }
  tipiRichiesti.forEach(k => chip(TIPI_LABEL[k] || k, () => {
    tipiRichiesti.delete(k);
    costruisciTipoChips();
  }));
  comuniRichiesti.forEach(n => chip('📍 ' + n, () => {
    comuniRichiesti.delete(n);
    costruisciComuneChips();
  }));
  FILTRI_ID.forEach(id => {
    const v = $('#' + id).value;
    if (!v) return;
    chip(FILTRI_ETICHETTE[id] ? FILTRI_ETICHETTE[id](v) : v, () => { $('#' + id).value = ''; });
  });
  caratRichieste.forEach(k => chip(CARAT_LABEL[k] || k, () => {
    caratRichieste.delete(k);
    document.querySelectorAll('#carat-chips .chip').forEach(c => {
      if ((CARAT_LABEL[k] || k) === c.textContent) c.classList.remove('active');
    });
  }));
  if ($('#annunci-no-centro').checked) chip('🚫 Fuori dai centri', () => { $('#annunci-no-centro').checked = false; });
  if ($('#annunci-con-prezzo').checked) chip('💶 Con prezzo', () => { $('#annunci-con-prezzo').checked = false; });
  if ($('#annunci-fibra-ok').checked) chip('📶 Con fibra', () => { $('#annunci-fibra-ok').checked = false; });
  if (areaPoligono) chip('🗺️ Area disegnata', () => { areaPoligono = null; salvaArea(); });

  // il badge sui cursori conta solo i filtri veri
  $('#conta-filtri').textContent = nFiltri || '';
  $('#conta-filtri').classList.toggle('hidden', !nFiltri);
  $('#btn-filtri').classList.toggle('attivo', !!nFiltri);

  // vista degli scartati: non è un filtro, è un posto dove andare
  if (mostraScartati) {
    const c = el('button', 'attivo-chip attivo-scartati', '🗑️ Nascosti · torna alla lista');
    c.addEventListener('click', () => { mostraScartati = false; renderAnnunci(); });
    bar.append(c);
  } else if (scartati.size) {
    const c = el('button', 'attivo-chip attivo-scartati', `🗑️ ${scartati.size} nascosti`);
    c.addEventListener('click', () => { mostraScartati = true; renderAnnunci(); });
    bar.append(c);
  }

  // zone con il numero a fianco
  if (!mostraScartati) {
    ZONE.forEach(z => {
      const n = contaZona(z.id);
      if (z.id && !n) return;                       // zona senza annunci: non la mostro
      const etichetta = z.id ? `${z.nome} ${n}` : z.nome;
      const c = el('button', 'chip chip-zona' + (zonaAttiva === z.id ? ' active' : ''), etichetta);
      c.addEventListener('click', () => {
        zonaAttiva = zonaAttiva === z.id ? '' : z.id;
        renderAnnunci(); salvaFiltri();
      });
      bar.append(c);
    });
  }
}

function statoFiltri() {
  const stato = { carat: [...caratRichieste], tipi: [...tipiRichiesti], zona: zonaAttiva,
    comuni: [...comuniRichiesti],
    noCentro: $('#annunci-no-centro').checked,
    conPrezzo: $('#annunci-con-prezzo').checked,
    fibraOk: $('#annunci-fibra-ok').checked, sort: $('#annunci-sort').value };
  FILTRI_ID.forEach(id => { stato[id] = $('#' + id).value; });
  return stato;
}

function salvaFiltri() {
  localStorage.setItem(FILTRI_KEY, JSON.stringify(statoFiltri()));
}

function applicaStato(stato) {
  if (!stato) return;
  FILTRI_ID.forEach(id => { $('#' + id).value = stato[id] || ''; });
  if (stato.sort) $('#annunci-sort').value = stato.sort;
  $('#annunci-no-centro').checked = !!stato.noCentro;
  $('#annunci-con-prezzo').checked = !!stato.conPrezzo;
  $('#annunci-fibra-ok').checked = !!stato.fibraOk;
  caratRichieste = new Set(stato.carat || []);
  tipiRichiesti = new Set(stato.tipi || []);
  comuniRichiesti = new Set(stato.comuni || []);
  zonaAttiva = stato.zona || '';
}

function ripristinaFiltri() {
  try { applicaStato(JSON.parse(localStorage.getItem(FILTRI_KEY) || 'null')); }
  catch (e) { /* filtri illeggibili: si parte puliti */ }
}

$('#btn-azzera').addEventListener('click', () => {
  FILTRI_ID.forEach(id => { $('#' + id).value = ''; });
  $('#annunci-no-centro').checked = false;
  $('#annunci-con-prezzo').checked = false;
  $('#annunci-fibra-ok').checked = false;
  caratRichieste.clear();
  tipiRichiesti.clear();
  comuniRichiesti.clear();
  costruisciTipoChips();
  costruisciComuneChips();
  zonaAttiva = '';
  areaPoligono = null;
  salvaArea();
  document.querySelectorAll('#carat-chips .chip').forEach(c => c.classList.remove('active'));
  salvaFiltri();
  renderAnnunci();
});

// ---------- Mappa: disegna l'area a mano libera ----------
const AREA_KEY = 'cercacasa_area';
let areaPoligono = null;   // [[lat, lon], ...]
let mappa = null, livelloArea = null, livelloPin = null, inDisegno = false;

try {
  const salvata = JSON.parse(localStorage.getItem(AREA_KEY) || 'null');
  if (Array.isArray(salvata) && salvata.length > 2) areaPoligono = salvata;
} catch (e) { /* area non valida: si parte senza */ }

function dentroArea(a) {
  if (!areaPoligono || a.lat == null || a.lon == null) return !areaPoligono;
  // ray casting
  let dentro = false;
  for (let i = 0, j = areaPoligono.length - 1; i < areaPoligono.length; j = i++) {
    const [yi, xi] = areaPoligono[i], [yj, xj] = areaPoligono[j];
    if ((yi > a.lat) !== (yj > a.lat) &&
        a.lon < ((xj - xi) * (a.lat - yi)) / (yj - yi) + xi) dentro = !dentro;
  }
  return dentro;
}

function aggiornaChipArea() {
  $('#area-attiva').classList.toggle('hidden', !areaPoligono);
}

function salvaArea() {
  if (areaPoligono) localStorage.setItem(AREA_KEY, JSON.stringify(areaPoligono));
  else localStorage.removeItem(AREA_KEY);
  aggiornaChipArea();
  renderAnnunci();
}

function disegnaAreaSuMappa() {
  if (livelloArea) { livelloArea.remove(); livelloArea = null; }
  if (areaPoligono) {
    livelloArea = L.polygon(areaPoligono, {
      color: '#C87533', weight: 3, fillOpacity: 0.12, fillColor: '#C87533',
    }).addTo(mappa);
  }
}

// Colori coerenti coi badge tipologia dell'app
const COLORI_TIPO = {
  indipendente: '#4A7C1F', porzione: '#B8860B', appartamento: '#5B8FBF',
  rustico: '#C87533', terreno: '#7a6255', altro: '#b09988',
};

function disegnaPinSuMappa() {
  if (livelloPin) livelloPin.remove();
  livelloPin = L.layerGroup().addTo(mappa);

  // Solo gli annunci che passano i filtri (l'area esclusa: la si sta ridisegnando)
  const visibili = filtraAnnunci(false).filter(a => a.lat != null && a.lon != null);
  visibili.forEach(a => {
    const m = L.circleMarker([a.lat, a.lon], {
      radius: 7, weight: 2, color: '#fffcf9',
      fillColor: COLORI_TIPO[a.tipo] || '#7a6255', fillOpacity: 0.95,
    });
    const prezzo = a.prezzo ? '€ ' + a.prezzo.toLocaleString('it-IT') : 'prezzo su richiesta';
    const appr = a.pos === 'comune' ? '<br><em>posizione approssimativa (centro del comune)</em>' : '';
    const dist = etichetteDistanza(a).join(' · ');
    m.bindPopup(`<b>${prezzo}</b><br>${a.titolo}<br>${a.comune || ''}` +
      (dist ? '<br>' + dist : '') + appr +
      `<br><a href="${a.url}" target="_blank" rel="noopener">Apri annuncio ↗</a>`);
    m.addTo(livelloPin);
  });

  // Punti di riferimento: lavoro e posizione attuale
  const rif = [];
  if (mostraCasa && posCasa) rif.push([posCasa, '🏠', posCasa.nome]);
  if (posLavoro) rif.push([posLavoro, '💼', posLavoro.nome]);
  if (mostraGps && posGps) rif.push([posGps, '📍', posGpsNome || 'La mia posizione']);
  rif.forEach(([p, icona, nome]) => {
    L.marker([p.lat, p.lon], {
      icon: L.divIcon({ className: 'rif-marker', html: icona, iconSize: [30, 30] }),
    }).bindPopup('<b>' + icona + ' ' + nome + '</b>').addTo(livelloPin);
  });

  return visibili.length;
}

function apriMappa() {
  $('#mappa-dialog').showModal();
  if (!mappa) {
    mappa = L.map('mappa', { zoomControl: true }).setView([44.15, 12.15], 10);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 18,
      attribution: '© OpenStreetMap',
    }).addTo(mappa);
  }
  setTimeout(() => {
    mappa.invalidateSize();
    const n = disegnaPinSuMappa();
    disegnaAreaSuMappa();
    $('#mappa-info').textContent = areaPoligono
      ? `${n} annunci sulla mappa · area attiva. "Disegna" per rifarla, "Cancella" per toglierla.`
      : `${n} annunci sulla mappa. Tocca "Disegna" e traccia col dito la zona che ti interessa.`;
    if (areaPoligono) {
      mappa.fitBounds(L.polygon(areaPoligono).getBounds(), { padding: [30, 30] });
    } else if (n) {
      const punti = filtraAnnunci(false).filter(a => a.lat != null).map(a => [a.lat, a.lon]);
      if (punti.length) mappa.fitBounds(L.latLngBounds(punti), { padding: [30, 30], maxZoom: 12 });
    }
  }, 120);
}

function fineDisegno(cont) {
  inDisegno = false;
  cont.style.touchAction = '';
  cont.classList.remove('in-disegno');
  mappa.dragging.enable();
  mappa.doubleClickZoom.enable();
  mappa.touchZoom.enable();
  if (mappa.tap) mappa.tap.enable();
  $('#btn-disegna').textContent = '✏️ Disegna area';
  $('#btn-disegna').classList.remove('btn-primary');
}

function avviaDisegno() {
  const cont = mappa.getContainer();
  if (inDisegno) { fineDisegno(cont); return; }   // secondo tocco: annulla
  inDisegno = true;

  $('#btn-disegna').textContent = '✋ Traccia col dito (tocca per annullare)';
  $('#btn-disegna').classList.add('btn-primary');
  $('#mappa-info').textContent = 'Appoggia il dito sulla mappa e traccia il contorno della zona.';

  // Senza questo il telefono interpreta il dito come scorrimento della mappa
  // e il tratto non parte mai: è il motivo per cui "funzionava malissimo".
  cont.style.touchAction = 'none';
  cont.classList.add('in-disegno');
  mappa.dragging.disable();
  mappa.doubleClickZoom.disable();
  mappa.touchZoom.disable();
  if (mappa.tap) mappa.tap.disable();

  let punti = [];
  let anteprima = null;

  const daEvento = e => {
    const r = cont.getBoundingClientRect();
    const p = mappa.containerPointToLatLng([e.clientX - r.left, e.clientY - r.top]);
    return [p.lat, p.lng];
  };

  const giu = e => {
    if (!inDisegno) return;
    e.preventDefault();
    try { cont.setPointerCapture(e.pointerId); } catch (err) { /* non supportato */ }
    punti = [daEvento(e)];
    if (anteprima) anteprima.remove();
    // poligono (non linea): si vede l'area che stai racchiudendo
    anteprima = L.polygon(punti, {
      color: '#C87533', weight: 3, fillColor: '#C87533', fillOpacity: 0.15, dashArray: '6,4',
    }).addTo(mappa);
    cont.addEventListener('pointermove', muovi);
  };

  const muovi = e => {
    e.preventDefault();
    const p = daEvento(e);
    const ultimo = punti[punti.length - 1];
    // un punto ogni ~4 px: tratto fluido senza migliaia di vertici
    if (Math.abs(p[0] - ultimo[0]) + Math.abs(p[1] - ultimo[1]) < 0.00004) return;
    punti.push(p);
    anteprima.setLatLngs(punti);
  };

  const su = e => {
    if (!inDisegno) return;
    cont.removeEventListener('pointermove', muovi);
    try { cont.releasePointerCapture(e.pointerId); } catch (err) { /* ignora */ }
    if (anteprima) anteprima.remove();

    if (punti.length > 4) {
      areaPoligono = punti.slice();
      fineDisegno(cont);
      disegnaAreaSuMappa();
      salvaArea();
      const n = filtraAnnunci(true).length;
      $('#mappa-info').textContent = n
        ? `Area salvata: ${n} annunci qui dentro. "Fatto" per vederli.`
        : 'In quell\'area non ci sono annunci: rifalla più grande o togli qualche filtro.';
    } else {
      // tratto troppo corto: resta in disegno, così può riprovare subito
      $('#mappa-info').textContent = 'Tratto troppo corto: tieni il dito premuto e gira intorno alla zona.';
    }
  };

  cont.addEventListener('pointerdown', giu);
  cont.addEventListener('pointerup', su);
  cont.addEventListener('pointercancel', su);
  // le funzioni restano agganciate finché la mappa è aperta: fineDisegno()
  // riabilita i gesti, e riaprendo il pannello si riparte puliti
}

$('#btn-mappa').addEventListener('click', () => {
  // se arrivo dal pannello filtri lo chiudo: niente finestre annidate
  if ($('#filtri-dialog').open) $('#filtri-dialog').close();
  apriMappa();
});
$('#btn-mappa-top').addEventListener('click', apriMappa);
$('#btn-disegna').addEventListener('click', avviaDisegno);
$('#btn-chiudi-mappa').addEventListener('click', () => {
  $('#mappa-dialog').close();
  renderAnnunci();
});
$('#btn-cancella-area').addEventListener('click', () => {
  areaPoligono = null;
  disegnaAreaSuMappa();
  salvaArea();
  $('#mappa-info').textContent = 'Area cancellata: vedi di nuovo tutti gli annunci.';
});
$('#btn-area-off').addEventListener('click', () => {
  areaPoligono = null;
  salvaArea();
});
aggiornaChipArea();

// ---------- Aggiornamento on-demand (helper locale sul Mac) ----------
const HELPER_URL = 'http://127.0.0.1:8787';

async function controllaHelper() {
  try {
    const r = await fetch(HELPER_URL + '/ping', { signal: AbortSignal.timeout(1500) });
    if (r.ok) $('#btn-refresh').classList.remove('hidden');
  } catch (e) { /* helper non attivo: si usano i dati pubblicati */ }
}

$('#btn-refresh').addEventListener('click', async () => {
  const btn = $('#btn-refresh');
  btn.disabled = true;
  btn.textContent = '⏳ Scarico e classifico…';
  try {
    const r = await fetch(HELPER_URL + '/aggiorna', {
      method: 'POST',
      signal: AbortSignal.timeout(300000),
    });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    annunciData = await r.json();
    popolaFonti();
    renderAnnunci();
  } catch (e) {
    alert('Aggiornamento fallito: ' + e.message);
  }
  btn.disabled = false;
  btn.textContent = '🔄 Aggiorna ora';
});

// ---------- Render: portali ----------
function renderPortali() {
  // se non scrivi niente si parte dalle zone che cerchi davvero
  const zona = $('#portali-zona').value.trim() || state.zoneFilter
    || zonesList()[0] || 'Cesena';
  const list = $('#portali-list');
  list.innerHTML = '';

  document.querySelectorAll('#contract-toggle button').forEach(b =>
    b.classList.toggle('active', b.dataset.contract === state.contract));

  if (!zona) {
    const empty = el('p', 'hint', 'Scrivi una zona qui sopra (o aggiungi una casa) per avere i link di ricerca pronti su tutti i portali.');
    list.append(empty);
  }

  PORTALS.forEach(p => {
    const a = el('a', 'portal-row');
    a.href = zona ? p.url(zona, state.contract) : 'https://' + (p.host || 'www.google.com');
    a.target = '_blank'; a.rel = 'noopener';
    const left = el('div');
    left.append(el('div', 'portal-name', p.name));
    left.append(el('div', 'portal-desc', zona ? `Cerca "${zona}" · ${state.contract}` : p.desc));
    a.append(left);
    a.append(el('span', 'portal-arrow', '→'));
    list.append(a);
  });

  const ag = $('#agenzie-list');
  ag.innerHTML = '';
  AGENZIE.forEach(([name, url]) => {
    const a = el('a', null, name);
    a.href = url; a.target = '_blank'; a.rel = 'noopener';
    ag.append(a);
  });
}

$('#portali-zona').addEventListener('input', renderPortali);
document.querySelectorAll('#contract-toggle button').forEach(b => {
  b.addEventListener('click', () => {
    state.contract = b.dataset.contract;
    save(); renderPortali();
  });
});

// ---------- Render: zone (tab Altro) ----------
function renderZoneManage() {
  const wrap = $('#zone-manage');
  wrap.innerHTML = '';
  const zones = zonesList();
  if (!zones.length) wrap.append(el('p', 'hint', 'Nessuna zona ancora.'));
  zones.forEach(z => {
    const inUse = state.houses.some(h => h.zona === z);
    const c = el('span', 'chip', z);
    if (!inUse) {
      const x = el('span', 'chip-x', '✕');
      x.addEventListener('click', () => {
        state.extraZones = state.extraZones.filter(e => e !== z);
        save(); renderAll();
      });
      c.append(x);
    }
    wrap.append(c);
  });

  const dl = $('#zone-datalist');
  dl.innerHTML = '';
  zones.forEach(z => {
    const o = document.createElement('option');
    o.value = z;
    dl.append(o);
  });
}

$('#zona-form').addEventListener('submit', e => {
  e.preventDefault();
  const z = $('#zona-input').value.trim();
  if (z && !zonesList().includes(z)) {
    state.extraZones.push(z);
    save();
  }
  $('#zona-input').value = '';
  renderAll();
});

// ---------- Dialog aggiungi/modifica ----------
const dialog = $('#house-dialog');

function fillSitoSelect() {
  const sel = $('#h-sito');
  sel.innerHTML = '';
  SITI_OPZIONI.forEach(s => {
    const o = document.createElement('option');
    o.value = s; o.textContent = s;
    sel.append(o);
  });
}

function detectSito(link) {
  try {
    const host = new URL(link).hostname;
    const p = PORTALS.find(p => p.host && host.includes(p.host));
    if (p && SITI_OPZIONI.includes(p.name)) return p.name;
    if (p) return 'Altro';
  } catch (e) { /* URL non valido */ }
  return null;
}

$('#h-link').addEventListener('change', () => {
  const s = detectSito($('#h-link').value);
  if (s) $('#h-sito').value = s;
});

function openDialog(id) {
  const h = id ? state.houses.find(x => x.id === id) : null;
  $('#dialog-title').textContent = h ? 'Modifica casa' : 'Aggiungi casa';
  $('#h-id').value = h ? h.id : '';
  $('#h-link').value = h?.link || '';
  $('#h-titolo').value = h?.titolo || '';
  $('#h-zona').value = h?.zona || state.zoneFilter || '';
  $('#h-sito').value = h?.sito || 'Immobiliare.it';
  $('#h-indirizzo').value = h?.indirizzo || '';
  $('#h-prezzo').value = h?.prezzo || '';
  $('#h-mq').value = h?.mq || '';
  $('#h-locali').value = h?.locali || '';
  $('#h-bagni').value = h?.bagni || '';
  $('#h-piano').value = h?.piano || '';
  $('#h-stato').value = h?.stato || 'da-valutare';
  $('#h-note').value = h?.note || '';
  dialog.showModal();
}

$('#btn-add').addEventListener('click', () => openDialog(null));
$('#btn-cancel').addEventListener('click', () => dialog.close());

$('#house-form').addEventListener('submit', e => {
  const zona = $('#h-zona').value.trim();
  if (!zona) { e.preventDefault(); return; }
  const id = $('#h-id').value || String(Date.now());
  const existing = state.houses.find(x => x.id === id);
  const h = {
    id,
    created: existing?.created || Date.now(),
    link: $('#h-link').value.trim(),
    titolo: $('#h-titolo').value.trim(),
    zona,
    sito: $('#h-sito').value,
    indirizzo: $('#h-indirizzo').value.trim(),
    prezzo: Number($('#h-prezzo').value) || null,
    mq: Number($('#h-mq').value) || null,
    locali: Number($('#h-locali').value) || null,
    bagni: Number($('#h-bagni').value) || null,
    piano: $('#h-piano').value.trim(),
    stato: $('#h-stato').value,
    note: $('#h-note').value.trim(),
  };
  if (existing) Object.assign(existing, h);
  else state.houses.push(h);
  save(); renderAll();
});

// ---------- Backup ----------
function aggiornaInfoSessione() {
  const p = $('#info-sessione');
  if (!p) return;
  const g = giorniSessioneRimasti();
  p.textContent = g
    ? `Resti dentro senza PIN ancora ${g} ${g === 1 ? 'giorno' : 'giorni'} (si rinnova a ogni apertura).`
    : 'Sessione scaduta: al prossimo avvio serve il PIN.';
}

// --- Impostazioni: i miei indirizzi ---
async function salvaIndirizzo(quale) {
  const inp = $(quale === 'casa' ? '#imp-casa' : '#imp-lavoro');
  const esito = $(quale === 'casa' ? '#imp-casa-esito' : '#imp-lavoro-esito');
  let testo = inp.value.trim();
  if (!testo) { esito.textContent = 'Scrivi un indirizzo.'; return; }

  // "Perfect Pack, Via Borghetto 4 Rimini" → etichetta + indirizzo
  let etichetta = null;
  const pezzi = testo.split(',').map(x => x.trim()).filter(Boolean);
  if (pezzi.length > 1 && !/\d/.test(pezzi[0]) &&
      !/^(via|viale|piazza|corso|largo|strada|vicolo|contrada|localit)/i.test(pezzi[0])) {
    etichetta = pezzi[0];
    testo = pezzi.slice(1).join(', ');
  }
  esito.textContent = 'Cerco…';
  const p = await geocodaIndirizzo(testo).catch(() => null);
  if (!p) { esito.textContent = 'Indirizzo non trovato. Aggiungi la città.'; return; }
  if (etichetta) p.nome = etichetta;

  if (quale === 'casa') {
    posCasa = p; mostraCasa = true;
    localStorage.setItem('cercacasa_casa', JSON.stringify(p));
  } else {
    posLavoro = p; mostraLavoro = true;
    localStorage.setItem('cercacasa_lavoro', JSON.stringify(p));
  }
  esito.textContent = '✓ ' + p.nome + ' — ' + p.completo.split(',').slice(0, 3).map(x=>x.trim()).join(', ');
  cacheStrada.clear();          // le distanze vanno ricalcolate dal punto nuovo
  aggiornaChipRif();
  renderAnnunci();
}

$('#btn-salva-casa')?.addEventListener('click', () => salvaIndirizzo('casa'));
$('#btn-salva-lavoro-imp')?.addEventListener('click', () => salvaIndirizzo('lavoro'));
['#imp-casa', '#imp-lavoro'].forEach(sel => {
  $(sel)?.addEventListener('keydown', e => {
    if (e.key === 'Enter') salvaIndirizzo(sel === '#imp-casa' ? 'casa' : 'lavoro');
  });
});

function riempiImpostazioni() {
  const c = $('#imp-casa'), l = $('#imp-lavoro');
  if (c && posCasa) c.value = [posCasa.nome, posCasa.completo].filter(Boolean).join(', ');
  if (l && posLavoro) l.value = [posLavoro.nome, posLavoro.completo].filter(Boolean).join(', ');
}

// --- Notifiche di case nuove -----------------------------------------
// Il telefono si iscrive al servizio su Railway; il servizio legge il file
// pubblicato dallo scraper e avvisa quando compare qualcosa che interessa.
// --- Ricerche salvate -------------------------------------------------
// Una ricerca è una fotografia dei filtri, con un nome e una sveglia sua:
// così "indipendente a Cesena" e "rustici da sistemare" avvisano separate,
// invece di dipendere dai filtri che per caso erano attivi quel giorno.
const RICERCHE_KEY = 'cercacasa_ricerche';

function leggiRicerche() {
  try { return JSON.parse(localStorage.getItem(RICERCHE_KEY) || '[]'); }
  catch (e) { return []; }
}
function scriviRicerche(r) {
  localStorage.setItem(RICERCHE_KEY, JSON.stringify(r));
}

// Descrizione a parole dei filtri: serve sia come nome proposto sia come
// sottotitolo, perché "Ricerca 2" fra sei mesi non dice niente.
function descriviStato(stato) {
  const pezzi = [];
  if (stato.tipi?.length) pezzi.push(stato.tipi.map(t => TIPI_LABEL[t] || t).join(', '));
  if (stato.zona) pezzi.push('a ' + (ZONE.find(z => z.id === stato.zona)?.nome || stato.zona));
  if (stato.comuni?.length) pezzi.push('📍 ' + stato.comuni.join(', '));
  FILTRI_ID.forEach(id => {
    const v = stato[id];
    if (v && FILTRI_ETICHETTE[id]) pezzi.push(FILTRI_ETICHETTE[id](v));
  });
  if (stato.noCentro) pezzi.push('fuori dal centro');
  if (stato.fibraOk) pezzi.push('con fibra');
  if (stato.conPrezzo) pezzi.push('solo con prezzo');
  return pezzi.join(' · ') || 'Tutti gli annunci';
}

// I filtri che il server sa applicare (un sottoinsieme: quelli che stanno
// nei dati pubblicati). Gli altri restano lato app.
function filtriServer(stato) {
  return {
    tipi: stato.tipi || [],
    prezzoMax: Number(stato['annunci-prezzo-max']) || null,
    prezzoMin: Number(stato['annunci-prezzo-min']) || null,
    mqMin: Number(stato['annunci-mq-min']) || null,
    soloConPrezzo: !!stato.conPrezzo,
    evitaCentri: !!stato.noCentro,
    comuni: [stato.zona, ...(stato.comuni || [])].filter(Boolean),
  };
}

// Primo tocco: propone un nome, che è la descrizione dei filtri accorciata.
// Secondo tocco: salva. Meglio di prompt(), che su iPhone in standalone è
// un pugno in un occhio e non si può precompilare in modo affidabile.
function chiediNomeRicerca() {
  const riga = $('#riga-nome-ricerca');
  const campo = $('#nome-ricerca');
  campo.value = descriviStato(statoFiltri()).slice(0, 60);
  riga.classList.remove('hidden');
  campo.focus();
  campo.select();
}

function salvaRicercaCorrente() {
  const stato = statoFiltri();
  const proposto = descriviStato(stato).slice(0, 60);
  const ricerche = leggiRicerche();
  ricerche.push({
    id: 'r' + Date.now(),
    nome: $('#nome-ricerca').value.trim() || proposto,
    stato,
    notifica: true,                                // la salvi per essere avvisata
  });
  scriviRicerche(ricerche);
  $('#riga-nome-ricerca').classList.add('hidden');
  $('#filtri-dialog').close();
  vaiA('altro');
  renderRicerche();
  inviaRicercheAlServer('Ricerca salvata.');
}

function renderRicerche() {
  const box = $('#lista-ricerche');
  if (!box) return;
  const ricerche = leggiRicerche();
  box.innerHTML = '';
  if (!ricerche.length) {
    box.append(el('p', 'hint', 'Nessuna ricerca salvata. Imposta i filtri che ti '
      + 'interessano e premi “Salva questa ricerca”.'));
    return;
  }
  ricerche.forEach(r => {
    const riga = el('div', 'ricerca-riga');
    const testo = el('button', 'ricerca-testo');
    testo.append(el('strong', '', r.nome), el('span', 'hint', descriviStato(r.stato)));
    testo.title = 'Applica questa ricerca';
    testo.addEventListener('click', () => {
      applicaStato(r.stato);
      costruisciTipoChips();
      salvaFiltri();
      vaiA('annunci');
      renderAnnunci();
    });

    const campanella = el('button', 'ricerca-sveglia' + (r.notifica ? ' attiva' : ''),
      r.notifica ? '🔔' : '🔕');
    campanella.title = r.notifica ? 'Ti avviso per questa ricerca' : 'Notifiche spente';
    campanella.setAttribute('aria-pressed', String(!!r.notifica));
    campanella.addEventListener('click', () => {
      r.notifica = !r.notifica;
      scriviRicerche(ricerche);
      renderRicerche();
      inviaRicercheAlServer(r.notifica ? `Ti avviso per “${r.nome}”.` : `Notifiche spente per “${r.nome}”.`);
    });

    const cestino = el('button', 'ricerca-elimina', '🗑️');
    cestino.title = 'Elimina questa ricerca';
    cestino.addEventListener('click', () => {
      if (!confirm(`Elimino la ricerca “${r.nome}”?`)) return;
      scriviRicerche(leggiRicerche().filter(x => x.id !== r.id));
      renderRicerche();
      inviaRicercheAlServer('Ricerca eliminata.');
    });

    riga.append(testo, campanella, cestino);
    box.append(riga);
  });
}

const SERVER_KEY = 'cercacasa_server';
const SERVER_DEFAULT = 'https://notifiche-production.up.railway.app';

function urlServer() {
  const salvato = localStorage.getItem(SERVER_KEY);
  return (salvato || SERVER_DEFAULT).replace(/\/+$/, '');
}

function base64ToUint8(b64) {
  const s = (b64 + '='.repeat((4 - b64.length % 4) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(s), c => c.charCodeAt(0));
}

// Le ricerche con la sveglia accesa: sono queste che il server confronta.
// Se non ne hai salvata nessuna vale quello che hai impostato adesso, così
// il bottone "Attiva" funziona anche al primo colpo.
function ricercheDaNotificare() {
  const scelte = leggiRicerche().filter(r => r.notifica);
  if (scelte.length) {
    return scelte.map(r => ({ id: r.id, nome: r.nome, filtri: filtriServer(r.stato) }));
  }
  const ora = statoFiltri();
  return [{ id: 'ora', nome: descriviStato(ora).slice(0, 60), filtri: filtriServer(ora) }];
}

async function attivaNotifiche() {
  const esito = $('#imp-notifiche-esito');
  const url = ($('#imp-server').value.trim() || SERVER_DEFAULT).replace(/\/+$/, '');
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    esito.textContent = 'Questo browser non supporta le notifiche. Su iPhone: aggiungi prima l\'app alla schermata Home.';
    return;
  }
  esito.textContent = 'Attivo…';
  try {
    const permesso = await Notification.requestPermission();
    if (permesso !== 'granted') { esito.textContent = 'Permesso negato dal telefono.'; return; }

    const rk = await fetch(url + '/chiave').then(r => r.json());
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: base64ToUint8(rk.chiave),
    });
    const ricerche = ricercheDaNotificare();
    const r = await fetch(url + '/iscrivi', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sub, ricerche }),
    });
    if (!r.ok) throw new Error('il servizio ha risposto ' + r.status);
    localStorage.setItem(SERVER_KEY, url);
    esito.textContent = '✓ Notifiche attive per: ' + ricerche.map(x => x.nome).join(' · ');
    $('#btn-spegni-notifiche').classList.remove('hidden');
    $('#btn-prova-notifica').classList.remove('hidden');
  } catch (e) {
    esito.textContent = 'Non ha funzionato: ' + e.message;
  }
}

// Rimanda al server l'elenco aggiornato, ma solo se il telefono è già
// iscritto: altrimenti accendere una sveglia chiederebbe il permesso a
// tradimento, senza che tu abbia premuto Attiva.
async function inviaRicercheAlServer(messaggio) {
  const esito = $('#imp-notifiche-esito');
  if (!('serviceWorker' in navigator)) return;
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = await reg?.pushManager.getSubscription();
    if (!sub) {
      if (esito && messaggio) esito.textContent = messaggio
        + ' Premi “Attiva le notifiche” per ricevere gli avvisi.';
      return;
    }
    const ricerche = ricercheDaNotificare();
    const r = await fetch(urlServer() + '/iscrivi', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sub, ricerche, silenzioso: true }),
    });
    if (esito) {
      esito.textContent = r.ok
        ? (messaggio || '') + ' Ti avviso per: ' + ricerche.map(x => x.nome).join(' · ')
        : 'Non sono riuscita ad aggiornare il servizio notifiche.';
    }
  } catch (e) {
    if (esito) esito.textContent = 'Non sono riuscita ad aggiornare il servizio: ' + e.message;
  }
}

async function spegniNotifiche() {
  const esito = $('#imp-notifiche-esito');
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) {
      await fetch(urlServer() + '/disiscrivi', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint: sub.endpoint }),
      }).catch(() => {});
      await sub.unsubscribe();
    }
    esito.textContent = 'Notifiche disattivate.';
    $('#btn-spegni-notifiche').classList.add('hidden');
    $('#btn-prova-notifica').classList.add('hidden');
  } catch (e) { esito.textContent = 'Errore: ' + e.message; }
}

async function provaNotifica() {
  const esito = $('#imp-notifiche-esito');
  esito.textContent = 'Mando…';
  try {
    const r = await fetch(urlServer() + '/prova', { method: 'POST' });
    const d = await r.json();
    const ok = (d.esiti || []).filter(x => x.consegnata).length;
    esito.textContent = ok
      ? `Mandata a ${ok} dispositiv${ok === 1 ? 'o' : 'i'}. Se non la vedi, controlla i permessi.`
      : 'Il servizio non è riuscito a mandarla: ' + ((d.esiti || [])[0]?.motivo || 'nessun dispositivo iscritto');
  } catch (e) {
    esito.textContent = 'Non ha funzionato: ' + e.message;
  }
}

$('#btn-attiva-notifiche')?.addEventListener('click', attivaNotifiche);
$('#btn-prova-notifica')?.addEventListener('click', provaNotifica);
$('#btn-salva-ricerca')?.addEventListener('click', chiediNomeRicerca);
$('#btn-conferma-ricerca')?.addEventListener('click', salvaRicercaCorrente);
$('#nome-ricerca')?.addEventListener('keydown', e => {
  if (e.key === 'Enter') { e.preventDefault(); salvaRicercaCorrente(); }
});
$('#btn-spegni-notifiche')?.addEventListener('click', spegniNotifiche);

// Non basta chiedere al telefono se è iscritto: dice di sì anche quando il
// servizio l'ha già dimenticato (iOS lascia cadere l'iscrizione da solo, e
// il servizio la butta al primo invio fallito). Finiva che l'app scriveva
// "✓ notifiche attive" e non arrivava mai niente. Quindi si chiede al
// servizio, e se non ci conosce più ci si riscrive senza disturbare: il
// permesso c'è già, non compare nessuna richiesta.
async function verificaIscrizione(sub) {
  const url = urlServer();
  try {
    const r = await fetch(url + '/iscritto', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ endpoint: sub.endpoint }),
    });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const d = await r.json();
    if (d.iscritto) return '✓ Notifiche attive. Ti avviso per: ' + (d.ricerche.join(' · ') || 'tutti gli annunci');
  } catch (e) {
    return 'Non riesco a parlare con il servizio notifiche: ' + e.message;
  }
  const ricerche = ricercheDaNotificare();
  const r = await fetch(url + '/iscrivi', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sub, ricerche, silenzioso: true }),
  }).catch(() => null);
  return r?.ok
    ? '✓ Notifiche riattivate (il servizio ci aveva persi). Ti avviso per: '
      + ricerche.map(x => x.nome).join(' · ')
    : 'Il servizio non ti ha più fra i dispositivi: premi “Attiva le notifiche”.';
}

async function riempiNotifiche() {
  const inp = $('#imp-server');
  if (inp && !inp.value) inp.value = urlServer();
  renderRicerche();
  if (!('serviceWorker' in navigator)) return;
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  $('#btn-spegni-notifiche')?.classList.toggle('hidden', !sub);
  $('#btn-prova-notifica')?.classList.toggle('hidden', !sub);
  if (!sub) return;
  const esito = $('#imp-notifiche-esito');
  esito.textContent = 'Controllo le notifiche…';
  esito.textContent = await verificaIscrizione(sub);
}

$('#btn-export').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(
    { houses: state.houses, visite: state.visite, extraZones: state.extraZones }, null, 2)],
    { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'cerca-casa-backup-' + new Date().toISOString().slice(0, 10) + '.json';
  a.click();
  URL.revokeObjectURL(a.href);
});

$('#btn-import').addEventListener('click', () => $('#import-file').click());
$('#import-file').addEventListener('change', async e => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (!Array.isArray(data.houses)) throw new Error('formato non valido');
    const nVisite = Array.isArray(data.visite) ? data.visite.length : 0;
    const quante = `${data.houses.length} case`
      + (nVisite ? ` e ${nVisite} visit${nVisite === 1 ? 'a' : 'e'}` : '');
    if (confirm(`Importare ${quante}? I dati attuali verranno sostituiti.`)) {
      state.houses = data.houses;
      state.visite = Array.isArray(data.visite) ? data.visite : [];
      state.extraZones = data.extraZones || [];
      save(); renderAll();
    }
  } catch (err) {
    alert('File non valido: ' + err.message);
  }
  e.target.value = '';
});

// ---------- Installa / blocca ----------
let deferredPrompt = null;
window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  deferredPrompt = e;
  $('#btn-install').classList.remove('hidden');
});
$('#btn-install').addEventListener('click', async () => {
  if (!deferredPrompt) return;
  deferredPrompt.prompt();
  await deferredPrompt.userChoice;
  deferredPrompt = null;
  $('#btn-install').classList.add('hidden');
});

$('#btn-lock').addEventListener('click', () => {
  localStorage.removeItem(UNLOCK_KEY);
  sessionStorage.removeItem(UNLOCK_KEY);
  location.reload();
});

// ---------- Filtri ----------
$('#filter-stato').addEventListener('change', renderHouses);
$('#sort-by').addEventListener('change', renderHouses);

// ---------- Init ----------
function renderAll() {
  renderZoneChips();
  renderHouses();
  renderVisite();
  renderZoneManage();
  renderPortali();
}

load();
fillSitoSelect();

if (sessioneValida()) {
  unlock();
} else if (!window.crypto?.subtle) {
  $('#pin-error').textContent = 'Apri l\'app in HTTPS per sbloccarla.';
  $('#pin-error').classList.remove('hidden');
}

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => { /* offline non disponibile */ });
}
