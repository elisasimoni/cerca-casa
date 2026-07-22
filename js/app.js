/* Cerca Casa — app di Elisa per la ricerca casa */
'use strict';

// SHA-256 del PIN (mai in chiaro nel codice: il repo è pubblico)
const PIN_HASH = '7463007726b9b4912187d8a4938ba975dbe7f28ce68b7aa9c0ac211ffa4b9b50';
const LS_KEY = 'cercacasa_v1';
const UNLOCK_KEY = 'cercacasa_unlocked';

const STATI = {
  'da-valutare': 'Da valutare',
  'contattata': 'Contattata',
  'visita': 'Visita fissata',
  'visitata': 'Visitata',
  'preferita': '⭐ Preferita',
  'scartata': 'Scartata',
};

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
let state = { houses: [], extraZones: [], contract: 'vendita', zoneFilter: '' };

function load() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) state = Object.assign(state, JSON.parse(raw));
  } catch (e) { /* dati corrotti: si riparte vuoti */ }
}
function save() {
  localStorage.setItem(LS_KEY, JSON.stringify({
    houses: state.houses, extraZones: state.extraZones, contract: state.contract,
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
  sessionStorage.setItem(UNLOCK_KEY, '1');
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
    if (btn.dataset.tab === 'annunci') loadAnnunci(true);
  });
});

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
  if (h.locali) meta.push('🚪 ' + h.locali + ' locali');
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

  const actions = el('div', 'card-actions');
  if (h.link) {
    const a = el('a', 'primary', 'Annuncio ↗');
    a.href = h.link; a.target = '_blank'; a.rel = 'noopener';
    actions.append(a);
  }
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

  $('#header-count').textContent = houses.length ? houses.length + (houses.length === 1 ? ' casa' : ' case') : '';

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

// ---------- Render: annunci (scraper automatico) ----------
let annunciData = null;

const TIPI_LABEL = {
  indipendente: '🏡 Indipendente',
  porzione: '🏘️ Porzione/schiera',
  appartamento: '🏢 Appartamento',
  rustico: '🌾 Rustico',
  terreno: '📐 Terreno',
  altro: '❓ Altro',
};

async function loadAnnunci(refetch) {
  if (!annunciData || refetch) {
    try {
      const res = await fetch('data/annunci.json', { cache: 'no-store' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      annunciData = await res.json();
      popolaFonti();
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
  popolaSelect($('#annunci-comune'),
    [...new Set(ann.map(a => a.comune).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'it')),
    'Tutti i comuni');
}

function annuncioCard(a) {
  const card = el('div', 'card');
  const wrap = el('div', 'annuncio-wrap');

  if (a.foto) {
    const img = el('img', 'annuncio-foto');
    img.src = a.foto; img.alt = ''; img.loading = 'lazy';
    img.addEventListener('error', () => img.remove());
    wrap.append(img);
  }

  const body = el('div', 'annuncio-body');
  const top = el('div', 'card-top');
  top.append(el('div', 'card-title', a.titolo));
  if (a.asta) top.append(el('span', 'stato-badge stato-scartata', 'Asta'));
  body.append(top);

  if (a.prezzo) {
    const pr = el('div', 'card-price');
    pr.append(el('span', 'price', '€ ' + a.prezzo.toLocaleString('it-IT')));
    if (a.mq) pr.append(el('span', 'price-mq', Math.round(a.prezzo / a.mq).toLocaleString('it-IT') + ' €/mq'));
    body.append(pr);
  }

  const meta = [];
  if (a.mq) meta.push('📐 ' + a.mq + ' mq');
  if (a.locali) meta.push('🚪 ' + a.locali + ' locali');
  if (a.bagni) meta.push('🛁 ' + a.bagni + (a.bagni == 1 ? ' bagno' : ' bagni'));
  if (a.piano) meta.push('🏢 piano ' + a.piano);
  if (a.alt != null) meta.push('⛰️ ' + a.alt + ' m');
  if (a.minuti != null) meta.push('🚗 ' + a.minuti + ' min');
  if (meta.length) body.append(el('div', 'card-meta', meta.join('  ·  ')));

  const luogo = [a.indirizzo, a.quartiere, a.comune].filter(Boolean).join(', ');
  if (luogo) {
    const addr = el('div', 'card-addr');
    const link = el('a', null, '📍 ' + luogo);
    link.href = 'https://www.google.com/maps/search/?api=1&query=' + enc(luogo);
    link.target = '_blank'; link.rel = 'noopener';
    addr.append(link);
    body.append(addr);
  }

  const badges = el('div', 'card-badges');
  if (a.tipo) badges.append(el('span', 'badge badge-tipo tipo-' + a.tipo, TIPI_LABEL[a.tipo] || a.tipo));
  badges.append(el('span', 'badge badge-sito', a.fonte));
  if (a.comune) badges.append(el('span', 'badge', a.comune));
  if (a.quartiere && a.quartiere !== a.comune) badges.append(el('span', 'badge', a.quartiere));
  body.append(badges);

  if (a.avviso) body.append(el('div', 'card-avviso', '⚠️ ' + a.avviso));

  if (a.descr) {
    const clip = a.descr.length > 160 ? a.descr.slice(0, 160) + '…' : a.descr;
    body.append(el('div', 'card-note', clip));
  }

  const actions = el('div', 'card-actions');
  const vedi = el('a', 'primary', 'Annuncio ↗');
  vedi.href = a.url; vedi.target = '_blank'; vedi.rel = 'noopener';
  actions.append(vedi);

  const giaSalvata = state.houses.some(h => h.link === a.url);
  const salva = el('button', giaSalvata ? 'saved' : null, giaSalvata ? '✓ Salvata' : '💾 Salva');
  salva.disabled = giaSalvata;
  salva.addEventListener('click', () => {
    state.houses.push({
      id: String(Date.now()),
      created: Date.now(),
      link: a.url,
      titolo: a.titolo,
      zona: a.quartiere || a.comune || 'Da smistare',
      sito: a.fonte,
      indirizzo: luogo,
      prezzo: a.prezzo, mq: a.mq, locali: a.locali, bagni: a.bagni,
      piano: a.piano || '',
      stato: 'da-valutare',
      note: '',
    });
    save(); renderAll(); renderAnnunci();
  });
  actions.append(salva);
  body.append(actions);

  wrap.append(body);
  card.append(wrap);
  return card;
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

  let items = [...annunciData.annunci];
  const fonte = $('#annunci-fonte').value;
  if (fonte) items = items.filter(a => a.fonte === fonte);
  const tipo = $('#annunci-tipo').value;
  if (tipo) items = items.filter(a => a.tipo === tipo);
  const comune = $('#annunci-comune').value;
  if (comune) items = items.filter(a => a.comune === comune);
  const prezzoMax = Number($('#annunci-prezzo-max').value);
  if (prezzoMax) items = items.filter(a => !a.prezzo || a.prezzo <= prezzoMax);
  const mqMin = Number($('#annunci-mq-min').value);
  if (mqMin) items = items.filter(a => a.mq && a.mq >= mqMin);
  const altMax = Number($('#annunci-alt-max').value);
  if (altMax) items = items.filter(a => a.alt == null || a.alt <= altMax);
  const minMax = Number($('#annunci-min-max').value);
  if (minMax) items = items.filter(a => a.minuti == null || a.minuti <= minMax);
  const q = $('#annunci-q').value.trim().toLowerCase();
  if (q) {
    items = items.filter(a =>
      [a.titolo, a.quartiere, a.indirizzo, a.comune, a.descr]
        .filter(Boolean).join(' ').toLowerCase().includes(q));
  }

  const sort = $('#annunci-sort').value;
  const num = v => Number(v) || 0;
  const eurmq = a => (a.prezzo && a.mq) ? a.prezzo / a.mq : Infinity;
  if (sort === 'prezzo-asc') items.sort((a, b) => (num(a.prezzo) || Infinity) - (num(b.prezzo) || Infinity));
  else if (sort === 'prezzo-desc') items.sort((a, b) => num(b.prezzo) - num(a.prezzo));
  else if (sort === 'mq-desc') items.sort((a, b) => num(b.mq) - num(a.mq));
  else if (sort === 'eurmq-asc') items.sort((a, b) => eurmq(a) - eurmq(b));
  else {
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
  info.textContent = `${items.length} annunci · aggiornati ${quando} · ${clf}` +
    (errori.length ? ` · ⚠️ ${errori.length} fonte/i in errore` : '');

  if (!items.length) {
    const empty = el('div', 'empty-state');
    empty.append(el('div', 'big', '📭'));
    empty.append(el('div', null, 'Nessun annuncio con questi filtri.'));
    list.append(empty);
    return;
  }
  items.forEach(a => list.append(annuncioCard(a)));
}

$('#annunci-q').addEventListener('input', renderAnnunci);
$('#annunci-fonte').addEventListener('change', renderAnnunci);
$('#annunci-sort').addEventListener('change', renderAnnunci);
$('#annunci-tipo').addEventListener('change', renderAnnunci);
$('#annunci-comune').addEventListener('change', renderAnnunci);
$('#annunci-prezzo-max').addEventListener('input', renderAnnunci);
$('#annunci-mq-min').addEventListener('input', renderAnnunci);
$('#annunci-alt-max').addEventListener('input', renderAnnunci);
$('#annunci-min-max').addEventListener('input', renderAnnunci);

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
  const zona = $('#portali-zona').value.trim() || state.zoneFilter || zonesList()[0] || '';
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
$('#btn-export').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify({ houses: state.houses, extraZones: state.extraZones }, null, 2)],
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
    if (confirm(`Importare ${data.houses.length} case? I dati attuali verranno sostituiti.`)) {
      state.houses = data.houses;
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
  renderZoneManage();
  renderPortali();
}

load();
fillSitoSelect();

if (sessionStorage.getItem(UNLOCK_KEY) === '1') {
  unlock();
} else if (!window.crypto?.subtle) {
  $('#pin-error').textContent = 'Apri l\'app in HTTPS per sbloccarla.';
  $('#pin-error').classList.remove('hidden');
}

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => { /* offline non disponibile */ });
}
