/* Cerca Casa — servizio notifiche
 *
 * Gira su Railway e avvisa il telefono quando compaiono case nuove che
 * corrispondono a quello che Elisa sta cercando.
 *
 * Perché NON fa lo scraping qui: i portali (Casa.it, Subito, Trovit) bloccano
 * gli indirizzi dei datacenter — provato, GitHub Actions veniva respinto.
 * Lo scraping resta sul Mac di Elisa (rete di casa) e pubblica il JSON su
 * GitHub Pages; questo servizio si limita a leggerlo e a confrontarlo con
 * l'ultima volta. Così le notifiche arrivano ovunque lei sia, e il Mac fa
 * solo quello che solo lui può fare.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import webpush from 'web-push';

const PORTA = process.env.PORT || 3000;
const DATI_URL = process.env.DATI_URL
  || 'https://elisasimoni.github.io/cerca-casa/data/annunci.json';
const CARTELLA = process.env.STORAGE_DIR || '/data';
const OGNI_MINUTI = Number(process.env.CONTROLLA_OGNI_MINUTI || 15);

// ---------------------------------------------------------------- memoria
// Su Railway serve un volume montato su /data, altrimenti al riavvio si
// perdono le iscrizioni: si ripiega su una cartella locale avvisando.
let cartella = CARTELLA;
try {
  fs.mkdirSync(cartella, { recursive: true });
  fs.accessSync(cartella, fs.constants.W_OK);
} catch (e) {
  cartella = path.join(process.cwd(), 'dati');
  fs.mkdirSync(cartella, { recursive: true });
  console.warn(`⚠️  ${CARTELLA} non scrivibile: uso ${cartella}. ` +
    'Senza un volume le iscrizioni si perdono a ogni riavvio.');
}
const FILE = n => path.join(cartella, n);

function leggi(nome, dflt) {
  try { return JSON.parse(fs.readFileSync(FILE(nome), 'utf8')); }
  catch (e) { return dflt; }
}
function scrivi(nome, dati) {
  fs.writeFileSync(FILE(nome), JSON.stringify(dati, null, 1));
}

// ------------------------------------------------------------- chiavi VAPID
// Identificano il mittente delle notifiche. Se non arrivano dalle variabili
// d'ambiente le genero una volta sola e le conservo.
let chiavi = leggi('vapid.json', null);
if (process.env.VAPID_PUBLIC && process.env.VAPID_PRIVATE) {
  chiavi = { publicKey: process.env.VAPID_PUBLIC, privateKey: process.env.VAPID_PRIVATE };
} else if (!chiavi) {
  chiavi = webpush.generateVAPIDKeys();
  scrivi('vapid.json', chiavi);
  console.log('Generate nuove chiavi VAPID.');
}
webpush.setVapidDetails(
  process.env.VAPID_CONTATTO || 'mailto:simoni.elisa00@gmail.com',
  chiavi.publicKey, chiavi.privateKey);

// ------------------------------------------------------------------- stato
let iscrizioni = leggi('iscrizioni.json', []);   // [{sub, filtri, creata}]
let idVisti = new Set(leggi('id_visti.json', []));
let ultimoControllo = null;
let ultimoEsito = 'mai eseguito';

// ------------------------------------------------------- filtri di interesse
// Gli stessi criteri dell'app: si notifica solo ciò che si sta cercando,
// altrimenti 90 annunci nuovi al giorno diventano rumore e si spegne tutto.
function interessa(a, f = {}) {
  if (!f || Object.keys(f).length === 0) return true;
  if (f.tipi?.length && !f.tipi.includes(a.tipo)) return false;
  if (f.prezzoMax && !(a.prezzo && a.prezzo <= f.prezzoMax)) return false;
  if (f.prezzoMin && !(a.prezzo && a.prezzo >= f.prezzoMin)) return false;
  if (f.mqMin && !(a.mq && a.mq >= f.mqMin)) return false;
  if (f.soloConPrezzo && !a.prezzo) return false;
  if (f.evitaCentri && a.centro) return false;
  if (f.comuni?.length) {
    const dove = [a.comune, a.quartiere, a.indirizzo].filter(Boolean).join(' ').toLowerCase();
    if (!f.comuni.some(c => dove.includes(String(c).toLowerCase()))) return false;
  }
  return true;
}

function testoNotifica(nuovi) {
  const n = nuovi.length;
  const titolo = n === 1 ? 'Una casa nuova' : `${n} case nuove`;
  const prima = nuovi[0];
  const prezzo = prima.prezzo ? '€ ' + prima.prezzo.toLocaleString('it-IT') : 'prezzo su richiesta';
  const dove = prima.quartiere || prima.comune || '';
  const corpo = n === 1
    ? `${prezzo}${prima.mq ? ' · ' + prima.mq + ' mq' : ''}${dove ? ' · ' + dove : ''}`
    : `La prima: ${prezzo}${dove ? ' a ' + dove : ''}`;
  return { titolo, corpo };
}

// ------------------------------------------------------------- il controllo
async function controlla() {
  ultimoControllo = new Date().toISOString();
  try {
    const r = await fetch(DATI_URL, { headers: { 'Cache-Control': 'no-cache' } });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const dati = await r.json();
    const annunci = dati.annunci || [];
    if (!annunci.length) throw new Error('nessun annuncio nel file');

    // primo giro: memorizzo e basta, non avviso su 700 annunci
    if (!idVisti.size) {
      idVisti = new Set(annunci.map(a => a.id));
      scrivi('id_visti.json', [...idVisti]);
      ultimoEsito = `primo giro: memorizzati ${idVisti.size} annunci`;
      console.log(ultimoEsito);
      return;
    }

    const nuovi = annunci.filter(a => !idVisti.has(a.id));
    annunci.forEach(a => idVisti.add(a.id));
    // non far crescere la memoria all'infinito
    const vivi = new Set(annunci.map(a => a.id));
    idVisti = new Set([...idVisti].filter(i => vivi.has(i)));
    scrivi('id_visti.json', [...idVisti]);

    if (!nuovi.length) {
      ultimoEsito = 'nessun annuncio nuovo';
      return;
    }

    let inviate = 0;
    for (const isc of [...iscrizioni]) {
      const suoi = nuovi.filter(a => interessa(a, isc.filtri));
      if (!suoi.length) continue;
      const { titolo, corpo } = testoNotifica(suoi);
      try {
        await webpush.sendNotification(isc.sub, JSON.stringify({
          titolo, corpo, quanti: suoi.length,
          url: 'https://elisasimoni.github.io/cerca-casa/',
        }), { TTL: 6 * 3600 });
        inviate++;
      } catch (e) {
        // 404/410 = il telefono ha revocato l'iscrizione: la tolgo
        if (e.statusCode === 404 || e.statusCode === 410) {
          iscrizioni = iscrizioni.filter(x => x.sub.endpoint !== isc.sub.endpoint);
          scrivi('iscrizioni.json', iscrizioni);
          console.log('Iscrizione scaduta rimossa.');
        } else {
          console.error('Invio fallito:', e.statusCode, e.body || e.message);
        }
      }
    }
    ultimoEsito = `${nuovi.length} nuovi, ${inviate} notifiche inviate`;
    console.log(ultimoEsito);
  } catch (e) {
    ultimoEsito = 'errore: ' + e.message;
    console.error(ultimoEsito);
  }
}

// ------------------------------------------------------------------- server
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};
const rispondi = (res, code, dati) => {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', ...CORS });
  res.end(JSON.stringify(dati));
};
const corpoDi = req => new Promise((ok, ko) => {
  let b = '';
  req.on('data', c => { b += c; if (b.length > 1e6) req.destroy(); });
  req.on('end', () => { try { ok(JSON.parse(b || '{}')); } catch (e) { ko(e); } });
  req.on('error', ko);
});

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (req.method === 'OPTIONS') { res.writeHead(204, CORS); return res.end(); }

  if (url.pathname === '/chiave') {
    return rispondi(res, 200, { chiave: chiavi.publicKey });
  }

  if (url.pathname === '/iscrivi' && req.method === 'POST') {
    try {
      const { sub, filtri } = await corpoDi(req);
      if (!sub?.endpoint) return rispondi(res, 400, { errore: 'iscrizione non valida' });
      iscrizioni = iscrizioni.filter(x => x.sub.endpoint !== sub.endpoint);
      iscrizioni.push({ sub, filtri: filtri || {}, creata: new Date().toISOString() });
      scrivi('iscrizioni.json', iscrizioni);
      // notifica di prova, così si vede subito che funziona
      await webpush.sendNotification(sub, JSON.stringify({
        titolo: 'Notifiche attivate ✅',
        corpo: 'Ti avviso quando compaiono case nuove che rientrano nella tua ricerca.',
        url: 'https://elisasimoni.github.io/cerca-casa/',
      })).catch(e => console.error('prova fallita:', e.statusCode));
      return rispondi(res, 200, { ok: true, iscritti: iscrizioni.length });
    } catch (e) {
      return rispondi(res, 400, { errore: String(e.message) });
    }
  }

  if (url.pathname === '/disiscrivi' && req.method === 'POST') {
    const { endpoint } = await corpoDi(req).catch(() => ({}));
    iscrizioni = iscrizioni.filter(x => x.sub.endpoint !== endpoint);
    scrivi('iscrizioni.json', iscrizioni);
    return rispondi(res, 200, { ok: true, iscritti: iscrizioni.length });
  }

  if (url.pathname === '/controlla' && req.method === 'POST') {
    await controlla();
    return rispondi(res, 200, { ok: true, esito: ultimoEsito });
  }

  if (url.pathname === '/' || url.pathname === '/stato') {
    return rispondi(res, 200, {
      servizio: 'Cerca Casa — notifiche',
      iscritti: iscrizioni.length,
      annunciMemorizzati: idVisti.size,
      ultimoControllo, ultimoEsito,
      controllaOgni: OGNI_MINUTI + ' minuti',
      fonte: DATI_URL,
      memoriaPersistente: cartella === CARTELLA,
    });
  }

  rispondi(res, 404, { errore: 'non trovato' });
}).listen(PORTA, () => {
  console.log(`Notifiche in ascolto sulla porta ${PORTA}`);
  console.log('Chiave pubblica VAPID:', chiavi.publicKey);
  controlla();
  setInterval(controlla, OGNI_MINUTI * 60 * 1000);
});
