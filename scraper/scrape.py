#!/usr/bin/env python3
"""Scraper annunci per Cerca Casa.

Legge config/ricerche.json, interroga Casa.it (HTML → __INITIAL_STATE__) e
Subito.it (API hades), scrive data/annunci.json. Solo libreria standard.
Nota: Immobiliare.it, Idealista e Wikicasa bloccano le richieste automatiche
(403 anti-bot), quindi le fonti sono Casa.it (agenzie) e Subito.it (privati).
"""
import json
import re
import subprocess
import sys
import time
import urllib.parse
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36")


def fetch(url, accept="text/html,application/xhtml+xml,*/*;q=0.8", retries=2):
    # urllib prende 403 dai portali (fingerprint TLS); curl invece passa.
    cmd = ["curl", "-sS", "-L", "--compressed", "--max-time", "30",
           "-w", "\n%{http_code}",
           "-H", f"User-Agent: {UA}",
           "-H", f"Accept: {accept}",
           "-H", "Accept-Language: it-IT,it;q=0.9",
           url]
    last = None
    for attempt in range(retries + 1):
        res = subprocess.run(cmd, capture_output=True, text=True)
        body, _, code = res.stdout.rpartition("\n")
        if res.returncode == 0 and code == "200":
            return body
        last = f"HTTP {code or '?'} (curl exit {res.returncode})"
        time.sleep(2 * (attempt + 1))
    raise RuntimeError(f"fetch fallita: {url} ({last})")


def fetch_post_json(url, payload, retries=2):
    cmd = ["curl", "-sS", "--compressed", "--max-time", "30",
           "-w", "\n%{http_code}",
           "-H", f"User-Agent: {UA}",
           "-H", "Accept: application/json",
           "-H", "Content-Type: application/json",
           "-X", "POST", "-d", json.dumps(payload),
           url]
    last = None
    for attempt in range(retries + 1):
        res = subprocess.run(cmd, capture_output=True, text=True)
        body, _, code = res.stdout.rpartition("\n")
        if res.returncode == 0 and code == "200":
            return json.loads(body)
        last = f"HTTP {code or '?'} (curl exit {res.returncode})"
        time.sleep(2 * (attempt + 1))
    raise RuntimeError(f"POST fallita: {url} ({last})")


def to_int(val):
    if val is None:
        return None
    if isinstance(val, (int, float)):
        return int(val)
    digits = re.sub(r"[^\d]", "", str(val))
    return int(digits) if digits else None


# ---------------------------------------------------------------- Casa.it
def casait_state(html):
    """Estrae window.__INITIAL_STATE__ = JSON.parse("...") (JSON doppio)."""
    i = html.find("__INITIAL_STATE__ = JSON.parse(")
    if i < 0:
        raise RuntimeError("INITIAL_STATE non trovato (layout cambiato?)")
    start = html.find('"', i)
    j = start + 1
    while True:
        j = html.find('"', j)
        if j < 0:
            raise RuntimeError("fine stringa INITIAL_STATE non trovata")
        k = j - 1
        n = 0
        while html[k] == "\\":
            n += 1
            k -= 1
        if n % 2 == 0:
            break
        j += 1
    return json.loads(json.loads(html[start:j + 1]))


def scrape_casait(ricerca):
    conf = ricerca.get("casait")
    if not conf:
        return []
    canale = "affitto" if ricerca["contratto"] == "affitto" else "vendita"
    slug = conf["slug"]
    out = []
    for page in range(1, int(conf.get("pagine", 2)) + 1):
        url = f"https://www.casa.it/{canale}/residenziale/{slug}/?sortType=date_desc"
        if page > 1:
            url += f"&page={page}"
        try:
            state = casait_state(fetch(url))
        except Exception as e:
            print(f"    Casa.it {slug} pagina {page}: {e} — tengo le {len(out)} già prese")
            break
        items = (state.get("search") or {}).get("list") or []
        if not items:
            break
        for it in items:
            feat = it.get("features") or {}
            price = ((feat.get("price") or {}).get("marker") or {}).get("originalPrice")
            geo = it.get("geoInfos") or {}
            title = it.get("title") or {}
            media = ((it.get("media") or {}).get("items") or [])
            foto = None
            if media and media[0].get("uri"):
                foto = "https://images-1.casa.it/360x265" + media[0]["uri"]
            out.append({
                "id": f"casait-{it.get('id')}",
                "fonte": "Casa.it",
                "titolo": title.get("main") or "Annuncio",
                "prezzo": to_int(price) or to_int((feat.get("price") or {}).get("value")),
                "mq": to_int(feat.get("mq")),
                "locali": to_int(feat.get("rooms")),
                "bagni": to_int(feat.get("bathrooms")),
                "piano": feat.get("level"),
                "indirizzo": geo.get("street"),
                "quartiere": geo.get("block_name") or geo.get("district_name"),
                "comune": geo.get("city"),
                "lat": geo.get("lat"),
                "lon": geo.get("lon"),
                "url": "https://www.casa.it" + (it.get("uri") or ""),
                "foto": foto,
                "asta": bool(it.get("isAuction")),
                "data": None,
                "descr": (it.get("description") or "")[:400],
            })
        time.sleep(1.5)
    return out


# --------------------------------------------------------------- Subito.it
def subito_feature(ad, uri):
    for f in ad.get("features") or []:
        if f.get("uri") == uri and f.get("values"):
            return f["values"][0].get("value")
    return None


def scrape_subito(ricerca):
    conf = ricerca.get("subito")
    if not conf:
        return []
    canale = "affitto" if ricerca["contratto"] == "affitto" else "vendita"
    page_url = (f"https://www.subito.it/annunci-{conf['regione']}/{canale}/"
                f"appartamenti/{conf['provincia']}/")
    if conf.get("comune"):
        page_url += f"{conf['comune']}/"
    html = fetch(page_url)
    m = re.search(r'<script id="__NEXT_DATA__" type="application/json">(.*?)</script>',
                  html, re.S)
    if not m:
        raise RuntimeError("NEXT_DATA subito non trovato (layout cambiato?)")
    nd = json.loads(m.group(1))
    geo = nd["props"]["pageProps"]["initialState"]["search"]["geo"]
    params = {
        "c": "7",  # categoria Appartamenti
        "t": "u" if canale == "affitto" else "s",
        "r": geo["region"]["id"],
        "ci": geo["city"]["id"],
        "lim": "100",
        "sort": "datedesc",
    }
    if geo.get("town"):  # assente per ricerche su tutta la provincia
        params["to"] = geo["town"]["id"]
    api = "https://hades.subito.it/v1/search/items?" + urllib.parse.urlencode(params)
    data = json.loads(fetch(api, accept="application/json"))
    out = []
    for ad in data.get("ads") or []:
        urn = ad.get("urn", "")
        m_id = re.search(r"id:ad:(\d+)", urn)
        imgs = ad.get("images") or []
        foto = (imgs[0].get("cdn_base_url") + "?rule=large-fixed-card-1x-auto")\
            if imgs and imgs[0].get("cdn_base_url") else None
        town = ((ad.get("geo") or {}).get("town") or {}).get("value")
        piano = subito_feature(ad, "/floor")
        out.append({
            "id": f"subito-{m_id.group(1) if m_id else urn}",
            "fonte": "Subito.it",
            "titolo": ad.get("subject") or "Annuncio",
            "prezzo": to_int(subito_feature(ad, "/price")),
            "mq": to_int(subito_feature(ad, "/size")),
            "locali": to_int(subito_feature(ad, "/room")),
            "bagni": to_int(subito_feature(ad, "/bathrooms")),
            "piano": ("T" if str(piano) == "0" else piano) if piano is not None else None,
            "indirizzo": None,
            "quartiere": None,
            "comune": town,
            "lat": None,
            "lon": None,
            "url": (ad.get("urls") or {}).get("default"),
            "foto": foto,
            "asta": False,
            "data": (ad.get("dates") or {}).get("display_iso8601"),
            "descr": (ad.get("body") or "")[:400].replace("\n", " "),
        })
    return out


# ----------------------------------------------------------------- Trovit
# Aggregatore: contiene anche gli annunci di Immobiliare.it/Idealista (che
# bloccano lo scraping diretto). Ogni card dichiara il portale d'origine in
# <small>: scartiamo quelli di Casa.it/Subito perché già presi direttamente.
FONTI_GIA_COPERTE = {"CASA.IT", "SUBITO", "SUBITO.IT"}


RE_TROVIT_DATA = re.compile(r'updated-date">\s*([^<]+)', re.I)


def data_da_testo(t):
    """"3 giorni fa", "ieri", "oggi", "30+ giorni fa" → data ISO."""
    if not t:
        return None
    t = t.strip().lower()
    oggi = datetime.now(timezone.utc).date()
    if "oggi" in t or "ora" in t or "minut" in t or "or e" in t:
        return oggi.isoformat()
    if "ieri" in t:
        return (oggi - timedelta(days=1)).isoformat()
    m = re.search(r"(\d+)\s*(giorn|settiman|mes)", t)
    if not m:
        return None
    n = int(m.group(1))
    giorni = n * {"giorn": 1, "settiman": 7, "mes": 30}[m.group(2)]
    return (oggi - timedelta(days=giorni)).isoformat()


def _trovit_card(card):
    did = re.search(r'data-id="(trovit-[^"]+)"', card)
    if not did:
        return None
    fonte_orig = re.search(r"<small>([^<]{2,40})</small>", card)
    fonte_orig = fonte_orig.group(1).strip() if fonte_orig else None
    if fonte_orig and fonte_orig.upper() in FONTI_GIA_COPERTE:
        return None
    titolo = re.search(r'title="([^"]{3,120})"\s+class="js-listing"', card)
    prezzo = re.search(r'class="price__actual"[^>]*>([^<]+)<', card)
    luogo = re.search(r'class="address_property-type"><b>([^<]*)</b>[^<]*?([^<]*)<', card)
    foto = re.search(r'<img[^>]+src="(https://images\.trovit\.com/[^"]+)"', card)
    locali = re.search(r"ic-room[^>]*>\s*<p>(\d+)", card)
    bagni = re.search(r"ic-bath[^>]*>\s*<p>(\d+)", card)
    mq = re.search(r"ic-size[^>]*>\s*<p>([\d.,]+)\s*m", card)

    quartiere = comune = None
    if luogo:
        testo = luogo.group(2).strip()
        if testo.startswith("a "):  # "Appartamento a 47013, Dovadola, ..."
            testo = testo[2:]
        parti = [p.strip() for p in testo.split(",") if p.strip()]
        parti = [p for p in parti
                 if not p.lower().startswith("provincia") and not p.isdigit()]
        if parti:
            comune = parti[-1]
            if len(parti) > 1:
                quartiere = parti[0].replace("Quartiere ", "")

    quando = RE_TROVIT_DATA.search(card)
    label = (fonte_orig or "Trovit").title().replace(".It", ".it")
    return {
        "id": did.group(1),
        "fonte": f"{label} · Trovit",
        "titolo": titolo.group(1) if titolo else (luogo.group(1) if luogo else "Annuncio"),
        "prezzo": to_int(prezzo.group(1)) if prezzo else None,
        "mq": to_int(mq.group(1)) if mq else None,
        "locali": to_int(locali.group(1)) if locali else None,
        "bagni": to_int(bagni.group(1)) if bagni else None,
        "piano": None,
        "indirizzo": None,
        "quartiere": quartiere,
        "comune": comune,
        "lat": None,
        "lon": None,
        "url": f"https://case.trovit.it/detail/{did.group(1)}",
        "foto": foto.group(1) if foto else None,
        "asta": "asta" in (titolo.group(1).lower() if titolo else ""),
        "data": data_da_testo(quando.group(1)) if quando else None,
        "descr": "",
    }


def scrape_trovit(ricerca):
    conf = ricerca.get("trovit")
    if not conf:
        return []
    canale = "affitto" if ricerca["contratto"] == "affitto" else "vendita"
    base = f"https://case.trovit.it/{canale}-{conf['slug']}"
    out = []
    for page in range(1, int(conf.get("pagine", 4)) + 1):
        url = base if page == 1 else f"{base}.{page}"
        # Una pagina che non risponde non deve buttare via quelle già prese:
        # Trovit ogni tanto stacca a metà giro e senza questo si perdevano
        # tutte le pagine della ricerca (176 → 99 annunci in un colpo).
        try:
            html = fetch(url)
        except Exception as e:
            print(f"    Trovit {conf['slug']} pagina {page}: {e} — tengo le {len(out)} già prese")
            break
        cards = html.split("<article")[1:]
        if not cards:
            break
        for card in cards:
            card = card.split("</article>")[0]
            item = _trovit_card(card)
            if item:
                out.append(item)
        time.sleep(1.5)
    return out


# -------------------------------------------------------- Aste PVP (Giustizia)
# Portale Vendite Pubbliche del Ministero: per legge TUTTE le aste giudiziarie
# passano da qui, quindi copre anche astalegale/asteannunci/canaleaste.
# Nota: l'endpoint contiene hash di deploy che possono cambiare — in tal caso
# la fonte va in errore (visibile nell'app) e va aggiornato PVP_RIC_BASE.
PVP_RIC_BASE = "https://pvp.giustizia.it/ric-496b258c-986a1b71/ric-ms"
PVP_DETTAGLIO = "https://pvp.giustizia.it/pvp/it/detail_annuncio.page?idAnnuncio="

CATEGORIE_BENE = {
    "APPARTAMENTO": "Appartamento", "ABITAZIONE_TIPO_POP": "Abitazione popolare",
    "VILLA": "Villa", "VILLETTA_SCHIERA": "Villetta a schiera",
    "ABITAZ_VILLINI": "Villino", "CASTELLO_PALAZZO": "Palazzo",
    "POSTO_AUTO": "Posto auto", "GARAGE_AUTORIMESSA": "Garage",
    "TERRENO": "Terreno", "ABITAZIONE_RURALE": "Casa rurale",
}


def scrape_pvp(ricerca):
    conf = ricerca.get("pvp")
    if not conf or ricerca["contratto"] != "vendita":
        return []
    payload = {
        "tipoLotto": "IMMOBILI",
        "codiceTribunale": conf["codiceTribunale"],
        "categoriaLotto": "IMMOBILE_RESIDENZIALE",
    }
    url = (PVP_RIC_BASE + "/ricerca/vendite"
           "?language=it&page=0&size=100&sort=dataOraVendita,desc")
    data = fetch_post_json(url, payload)
    oggi = datetime.now(timezone.utc).date().isoformat()
    prov_filtro = (conf.get("provincia") or "").lower()
    out = []
    for lotto in (data.get("body") or {}).get("content") or []:
        if (lotto.get("dataVendita") or "") < oggi:
            continue  # vendita già passata
        ind = lotto.get("indirizzo") or {}
        if prov_filtro and (ind.get("provincia") or "").lower() != prov_filtro:
            continue  # il tribunale gestisce anche immobili fuori provincia
        beni = [CATEGORIE_BENE.get(b, b.replace("_", " ").capitalize())
                for b in lotto.get("categoriaBene") or []]
        coord = ind.get("coordinate") or {}
        indirizzo = ", ".join(x for x in (ind.get("via"), ind.get("citta")) if x)
        vendita = lotto.get("dataVendita") or "?"
        minima = lotto.get("offertaMinima")
        extra = f"Vendita il {vendita}"
        if minima:
            extra += f" · offerta minima € {int(minima):,}".replace(",", ".")
        out.append({
            "id": f"pvp-{lotto['id']}",
            "fonte": "Aste PVP",
            "titolo": "Asta: " + (" + ".join(beni) or "Immobile") + f" a {ind.get('citta') or '?'}",
            "prezzo": to_int(lotto.get("prezzoBaseAsta")),
            "mq": None, "locali": None, "bagni": None, "piano": None,
            "indirizzo": indirizzo or None,
            "quartiere": None,
            "comune": ind.get("citta"),
            "lat": coord.get("latitudine"),
            "lon": coord.get("longitudine"),
            "url": PVP_DETTAGLIO + str(lotto["id"]),
            "foto": lotto.get("immagineCover") or lotto.get("immagine"),
            "asta": True,
            "data": lotto.get("dataPubblicazione"),
            "descr": extra + " — " + (lotto.get("descLotto") or "")[:400],
        })
    return out


# --------------------------------------------- Caratteristiche e condizione
# Estratte dal testo (titolo + descrizione): i portali le espongono in modi
# diversi, il testo libero è il minimo comune denominatore.
CARATTERISTICHE = {
    "giardino": r"giardin|corte esclusiv|parco privat",
    "terrazzo": r"terrazz|altana|lastric",
    "balcone": r"balcon|loggia|logge",
    "garage": r"garage|autorimess|box auto|posto auto|posti auto",
    "ascensore": r"ascensor",
    "cantina": r"cantina|taverna|seminterrat",
    "piscina": r"piscina",
    "camino": r"camino|stufa a pellet|termocamino",
    "arredato": r"arredat",
    "climatizzato": r"aria condizionat|climatizzat|condizionator",
    "panoramico": r"panoramic|vista mare|vista collin",
    "fotovoltaico": r"fotovoltaic|pannelli solari",
    "fibra": r"fibra ottica|\bftth\b|fibra internet|connessione in fibra",
}
CONDIZIONI = [
    ("da-ristrutturare", r"da ristruttur|da riattare|necessita di ristruttur|"
                        r"da rimodernare|grezzo|al grezzo"),
    ("nuovo", r"nuova costruzion|di nuova realizzazion|mai abitat|in costruzion"),
    ("ristrutturato", r"ristruttur|rinnovat|rimodernat|ottimo stato|"
                     r"ottime condizioni|come nuovo|finemente"),
]
RE_CLASSE = re.compile(r"class[ei]\s+energetic\w*\s*:?\s*[«\"']?\s*([A-G]\d?\+?)\b", re.I)
RE_CENTRO = re.compile(r"centro storico|pieno centro|centralissim|in centro|"
                       r"zona centro|centro citt|centro paese", re.I)


def estrai_caratteristiche(a):
    testo = f"{a.get('titolo') or ''} {a.get('descr') or ''}".lower()
    a["carat"] = sorted(k for k, pat in CARATTERISTICHE.items()
                        if re.search(pat, testo))
    a["condizione"] = next((nome for nome, pat in CONDIZIONI
                            if re.search(pat, testo)), None)
    m = RE_CLASSE.search(testo)
    a["classe"] = m.group(1).upper() if m else None
    # "centro" dal quartiere dichiarato dal portale o dal testo
    quart = (a.get("quartiere") or "").lower()
    a["centro"] = bool(quart == "centro" or "centro stor" in quart
                       or RE_CENTRO.search(testo))


# ------------------------------------- Arricchimento geografico (alt + guida)
# Altitudine da Open-Meteo (filtro anti-montagna) e minuti di guida reali dal
# punto di riferimento via OSRM/OpenStreetMap (le strade tortuose si vedono
# dal tempo). Waze non ha API pubbliche. Cache per non rifare le chiamate.
CACHE_GEO = ROOT / "scraper" / "geo_cache.json"

# centroide approssimativo + altitudine dei comuni FC (fallback quando
# l'annuncio non ha coordinate proprie)
COMUNI_FC = {
    "forli": (44.222, 12.041, 34), "cesena": (44.139, 12.243, 44),
    "cesenatico": (44.200, 12.395, 2), "savignano sul rubicone": (44.090, 12.395, 29),
    "san mauro pascoli": (44.108, 12.417, 20), "gatteo": (44.110, 12.388, 25),
    "gambettola": (44.121, 12.339, 20), "longiano": (44.073, 12.326, 179),
    "montiano": (44.083, 12.305, 159), "roncofreddo": (44.041, 12.317, 314),
    "sogliano al rubicone": (43.996, 12.303, 382), "borghi": (44.031, 12.353, 270),
    "mercato saraceno": (43.959, 12.196, 161), "sarsina": (43.919, 12.143, 243),
    "bagno di romagna": (43.831, 11.958, 491), "verghereto": (43.795, 12.006, 812),
    "santa sofia": (43.947, 11.907, 257), "galeata": (43.997, 11.913, 235),
    "civitella di romagna": (44.006, 11.938, 219), "premilcuore": (43.978, 11.780, 459),
    "predappio": (44.101, 11.982, 133), "meldola": (44.127, 12.061, 57),
    "bertinoro": (44.148, 12.135, 257), "forlimpopoli": (44.188, 12.127, 31),
    "castrocaro terme e terra del sole": (44.174, 11.941, 68),
    "castrocaro terme": (44.174, 11.941, 68), "dovadola": (44.121, 11.885, 140),
    "rocca san casciano": (44.060, 11.845, 210),
    "portico e san benedetto": (44.026, 11.782, 309), "tredozio": (44.079, 11.746, 334),
    "modigliana": (44.157, 11.790, 185),
    # frazioni che interessano a Elisa (trattate come località a sé)
    "santa maria nuova": (44.169, 12.139, 44),
}

# Località su cui Elisa sta cercando: usate per il filtro rapido "Le mie zone".
# Santa Maria Nuova è frazione di Bertinoro: la riconosco anche dal quartiere.
ZONE_PREFERITE = {
    "santa maria nuova": ("bertinoro", "santa maria nuova"),
    "cesena": ("cesena", None),
    "gambettola": ("gambettola", None),
    "forli": ("forli", None),
}


def zona_preferita(a):
    """Ritorna l'etichetta della zona preferita che combacia, se c'è."""
    comune = norm_comune(a.get("comune"))
    quart = norm_comune(a.get("quartiere"))
    testo = norm_comune(f"{a.get('titolo') or ''} {a.get('indirizzo') or ''}")
    for label, (com_atteso, frazione) in ZONE_PREFERITE.items():
        if frazione:
            if frazione in quart or frazione in testo:
                return label
        elif comune == com_atteso:
            return label
    return None


# Le fonti scrivono lo stesso comune in modi diversi ("Forlì" e "Forli'"):
# senza questa tabella la tendina mostra due voci per la stessa città.
COMUNE_UFFICIALE = {
    "forli": "Forlì", "forli cesena": "Forlì", "cesena": "Cesena",
    "bertinoro": "Bertinoro", "gambettola": "Gambettola",
    "cesenatico": "Cesenatico", "forlimpopoli": "Forlimpopoli",
    "savignano sul rubicone": "Savignano sul Rubicone",
    "san mauro pascoli": "San Mauro Pascoli", "meldola": "Meldola",
    "mercato saraceno": "Mercato Saraceno", "longiano": "Longiano",
    "predappio": "Predappio", "civitella di romagna": "Civitella di Romagna",
    "sogliano al rubicone": "Sogliano al Rubicone", "roncofreddo": "Roncofreddo",
    "santa sofia": "Santa Sofia", "bagno di romagna": "Bagno di Romagna",
    "galeata": "Galeata", "modigliana": "Modigliana", "sarsina": "Sarsina",
    "montiano": "Montiano", "gatteo": "Gatteo", "borghi": "Borghi",
    "dovadola": "Dovadola", "verghereto": "Verghereto", "premilcuore": "Premilcuore",
    "tredozio": "Tredozio", "rocca san casciano": "Rocca San Casciano",
    "castrocaro terme e terra del sole": "Castrocaro Terme",
    "castrocaro terme": "Castrocaro Terme",
    "portico e san benedetto": "Portico e San Benedetto",
}


def uniforma_comune(nome):
    """Riporta il comune alla grafia ufficiale, così non compare due volte."""
    if not nome:
        return nome
    return COMUNE_UFFICIALE.get(norm_comune(nome), nome.strip())


def norm_comune(nome):
    if not nome:
        return ""
    import unicodedata
    s = unicodedata.normalize("NFD", nome.lower())
    s = "".join(c for c in s if not unicodedata.combining(c))
    return s.replace("'", "").replace("’", "").strip()


def coord_annuncio(a):
    if a.get("lat") and a.get("lon"):
        return round(a["lat"], 4), round(a["lon"], 4), None
    c = COMUNI_FC.get(norm_comune(a.get("comune")))
    if c:
        return c[0], c[1], c[2]
    return None, None, None


def arricchisci_geo(annunci, config):
    try:
        cache = json.loads(CACHE_GEO.read_text("utf-8"))
    except (OSError, json.JSONDecodeError):
        cache = {}
    rif = config.get("riferimento") or {"lat": 44.2227, "lon": 12.0407}

    punti = {}  # chiave -> (lat, lon, alt_fallback)
    for a in annunci:
        lat, lon, alt_fb = coord_annuncio(a)
        if lat is None:
            continue
        punti[f"{lat},{lon}"] = (lat, lon, alt_fb)

    da_fare = [k for k in punti if k not in cache]

    # altitudine (Open-Meteo, batch da 90)
    for i in range(0, len(da_fare), 90):
        blocco = da_fare[i:i + 90]
        lats = ",".join(str(punti[k][0]) for k in blocco)
        lons = ",".join(str(punti[k][1]) for k in blocco)
        try:
            data = json.loads(fetch(
                f"https://api.open-meteo.com/v1/elevation?latitude={lats}&longitude={lons}",
                accept="application/json"))
            for k, alt in zip(blocco, data.get("elevation") or []):
                cache.setdefault(k, {})["alt"] = round(alt)
        except Exception as e:
            print(f"  open-meteo non raggiungibile: {e}", file=sys.stderr)
            break

    # minuti di guida dal riferimento (OSRM table, batch da 80)
    for i in range(0, len(da_fare), 80):
        blocco = da_fare[i:i + 80]
        coords = f"{rif['lon']},{rif['lat']};" + ";".join(
            f"{punti[k][1]},{punti[k][0]}" for k in blocco)
        dests = ";".join(str(n + 1) for n in range(len(blocco)))
        try:
            data = json.loads(fetch(
                f"https://router.project-osrm.org/table/v1/driving/{coords}"
                f"?sources=0&destinations={dests}",
                accept="application/json"))
            durate = (data.get("durations") or [[]])[0]
            for k, sec in zip(blocco, durate):
                if sec is not None:
                    cache.setdefault(k, {})["minuti"] = round(sec / 60)
        except Exception as e:
            print(f"  OSRM non raggiungibile: {e}", file=sys.stderr)
            break
        time.sleep(1)

    n_ok = 0
    for a in annunci:
        esatta = a.get("lat") is not None and a.get("lon") is not None
        lat, lon, alt_fb = coord_annuncio(a)
        if lat is None:
            a["alt"] = a["minuti"] = a["pos"] = None
            continue
        info = cache.get(f"{lat},{lon}", {})
        a["alt"] = info.get("alt", alt_fb)
        a["minuti"] = info.get("minuti")
        a["lat"], a["lon"] = lat, lon
        a["pos"] = "esatta" if esatta else "comune"
        if a["alt"] is not None:
            n_ok += 1
    CACHE_GEO.write_text(json.dumps(cache, ensure_ascii=False, indent=0), "utf-8")
    print(f"Geo: altitudine/guida per {n_ok}/{len(annunci)} annunci")


# ------------------------------------------- Classificatore tipologia (AI)
# Gli annunci mentono: "casa indipendente" nel titolo, "porzione di
# bifamiliare" nella descrizione. Doppio motore: Claude CLI (se autenticata
# sul Mac) legge titolo+descrizione; altrimenti regole linguistiche.
# La cache evita di riclassificare gli annunci già visti.
CACHE_TIPI = ROOT / "scraper" / "tipi_cache.json"
TIPI_VALIDI = {"indipendente", "porzione", "appartamento", "rustico",
               "terreno", "altro"}

RE_INDIP_TITOLO = re.compile(
    r"indipendente|casa singola|unifamiliare|villa singola", re.I)


# "Libera su 4 lati" = davvero staccata. Su 2 o 3 lati = attaccata a qualcosa,
# quindi porzione, anche se il titolo dice "casa indipendente".
RE_LATI_LIBERI = re.compile(
    r"liber\w*\s+su\s+(due|tre|2|3)\s+lat", re.I)
RE_ANGOLARE = re.compile(
    r"(villett\w+|vill\w+|cas\w+|unit\w+|porzion\w+|soluzion\w+)\s+angolare", re.I)


def classifica_regole(titolo, descr):
    t = f"{titolo} {descr}".lower()

    def ha(*parole):
        return any(p in t for p in parole)

    if (RE_LATI_LIBERI.search(t) or RE_ANGOLARE.search(t)
            or ha("porzione", "bifamiliare", "trifamiliare", "quadrifamiliare",
                  "schiera", "semindipendente", "semi-indipendente",
                  "in aderenza", "terratetto")):
        tipo = "porzione"
    elif ha("appartament", "trilocale", "bilocale", "quadrilocale",
            "monolocale", "attico", "mansarda", "condomini", "palazzina"):
        tipo = "appartamento"
    elif ha("rustico", "casale", "colonic", "podere", "cascina"):
        tipo = "rustico"
    elif t.strip().startswith("terreno") or ha("terreno edificabile"):
        tipo = "terreno"
    elif ha("indipendente", "casa singola", "unifamiliare", "villa",
            "villino", "villetta"):
        tipo = "indipendente"
    else:
        tipo = "altro"

    avviso = None
    if tipo in ("porzione", "appartamento") and RE_INDIP_TITOLO.search(titolo):
        avviso = f"Il titolo dice \"indipendente\" ma il testo suggerisce: {tipo}"
    return {"tipo": tipo, "avviso": avviso, "via": "regole"}


def classifica_ai_batch(items):
    """Classifica con `claude -p` (haiku). Ritorna {} se la CLI non è loggata."""
    compatti = [{"id": a["id"], "titolo": a["titolo"],
                 "descr": (a.get("descr") or "")[:350]} for a in items]
    prompt = (
        "Classifica questi annunci immobiliari italiani. Per ognuno decidi la "
        "tipologia REALE leggendo titolo e descrizione (spesso il titolo mente: "
        "dice 'casa indipendente' ma la descrizione rivela una porzione di "
        "bifamiliare o un appartamento).\n"
        "Tipologie: indipendente (casa davvero singola, villa singola), "
        "porzione (porzione di bi/trifamiliare, schiera, terratetto in "
        "aderenza, semindipendente), appartamento, rustico (casale/colonica da "
        "ristrutturare), terreno, altro.\n"
        "REGOLA DECISIVA sui lati liberi: 'libera su 4 lati' o 'su quattro "
        "lati' = indipendente; 'libera su 3 lati', 'su 2 lati', 'villetta "
        "angolare', 'di testa' = PORZIONE, perché è attaccata ad altro, anche "
        "se il titolo dice 'casa indipendente'.\n"
        "Rispondi SOLO con un array JSON, un elemento per annuncio: "
        '[{"id": "...", "tipo": "...", "avviso": null oppure "breve nota se il '
        'titolo promette una tipologia diversa da quella reale"}]\n\n'
        + json.dumps(compatti, ensure_ascii=False)
    )
    res = subprocess.run(["claude", "-p", "--model", "haiku", prompt],
                         capture_output=True, text=True, timeout=180)
    if res.returncode != 0 or "Not logged in" in res.stdout + res.stderr:
        return {}
    testo = res.stdout
    i, j = testo.find("["), testo.rfind("]")
    if i < 0 or j <= i:
        return {}
    try:
        dati = json.loads(testo[i:j + 1])
    except json.JSONDecodeError:
        return {}
    out = {}
    for d in dati:
        if isinstance(d, dict) and d.get("id") and d.get("tipo") in TIPI_VALIDI:
            out[d["id"]] = {"tipo": d["tipo"],
                            "avviso": d.get("avviso") or None, "via": "ai"}
    return out


def _priorita_ai(a):
    # Prima le tipologie che decidono le scelte di Elisa (indipendente/porzione),
    # poi le sue zone: se il tempo finisce, il resto va al giro dopo.
    tipo = 0 if a.get("tipo") in ("indipendente", "porzione") else 1
    zona = 0 if a.get("zona") else 1
    return (tipo, zona)


def classifica_tutti(annunci, budget_secondi=360):
    try:
        cache = json.loads(CACHE_TIPI.read_text("utf-8"))
    except (OSError, json.JSONDecodeError):
        cache = {}

    da_ai = [a for a in annunci
             if a["id"] not in cache or cache[a["id"]].get("via") == "regole"]
    da_ai.sort(key=_priorita_ai)
    scadenza = time.monotonic() + budget_secondi
    falliti_di_fila = 0
    for i in range(0, len(da_ai), 25):
        if time.monotonic() > scadenza:
            print(f"  budget AI esaurito: {len(da_ai) - i} annunci al prossimo giro")
            break
        batch = da_ai[i:i + 25]
        try:
            risultati = classifica_ai_batch(batch)
        except Exception:
            risultati = {}
        if not risultati:
            # Un batch può fallire per un intoppo passeggero (rate limit,
            # JSON malformato): salta e prosegui. Ci si arrende solo se
            # falliscono 3 batch di fila (CLI non loggata / servizio giù).
            falliti_di_fila += 1
            print(f"  batch AI a vuoto ({falliti_di_fila}/3), proseguo")
            if falliti_di_fila >= 3:
                print("  AI non disponibile: il resto va con le regole")
                break
            continue
        falliti_di_fila = 0
        cache.update(risultati)
        print(f"  classificati con AI: {len(risultati)}/{len(batch)}")

    n_ai = n_regole = 0
    for a in annunci:
        info = cache.get(a["id"])
        if not info:
            info = classifica_regole(a["titolo"], a.get("descr") or "")
            cache[a["id"]] = info
        a["tipo"] = info["tipo"]
        a["avviso"] = info.get("avviso")
        if info.get("via") == "ai":
            n_ai += 1
        else:
            n_regole += 1

    # tieni in cache solo gli id ancora vivi (evita crescita infinita)
    vivi = {a["id"] for a in annunci}
    cache = {k: v for k, v in cache.items() if k in vivi}
    CACHE_TIPI.write_text(json.dumps(cache, ensure_ascii=False, indent=0),
                          "utf-8")
    print(f"Tipologie: {n_ai} via AI, {n_regole} via regole")
    return "ai" if n_regole == 0 else ("misto" if n_ai else "regole")


# ------------------------------------------- Copertura fibra (piano pubblico)
# API aperta del portale governativo Banda Ultra Larga: dà lo stato dei lavori
# comune per comune. Riguarda le "aree bianche" (zone che il mercato non
# copriva), quindi nei centri città la fibra commerciale c'è spesso comunque:
# per l'indirizzo esatto serve la verifica su Open Fiber, che l'app offre a
# parte. Qui si dice se il piano pubblico è arrivato o no.
BUL_API = "https://bandaultralarga.italia.it/wp-json/bul/v1/region/"

STATO_FIBRA = {
    "terminato": ("ok", "Piano fibra pubblica completato"),
    "lavori chiusi": ("ok", "Lavori fibra pubblica chiusi"),
    "in collaudo": ("quasi", "Fibra pubblica in collaudo"),
    "in esecuzione": ("corso", "Lavori fibra pubblica in corso"),
    "in progettazione esecutiva": ("corso", "Fibra pubblica in progettazione"),
    "in progettazione definitiva": ("corso", "Fibra pubblica in progettazione"),
    "in programmazione": ("no", "Fibra pubblica solo programmata"),
}


def stato_fibra_comuni(id_regione=8, provincia_id=40):
    """Mappa comune (normalizzato) → stato della fibra del piano pubblico."""
    try:
        dati = json.loads(fetch(BUL_API + str(id_regione), accept="application/json"))
    except Exception as e:
        print(f"  BUL non raggiungibile: {e}", file=sys.stderr)
        return {}
    out = {}
    for f in dati.get("features") or []:
        p = f.get("properties") or {}
        if provincia_id and p.get("province_id") != provincia_id:
            continue
        wf = ((p.get("work_progress") or {}).get("fiber") or {})
        stato = wf.get("status")
        if not stato:
            continue
        livello, testo = STATO_FIBRA.get(stato, ("?", "Fibra pubblica: " + stato))
        out[norm_comune(p.get("city_name"))] = {
            "livello": livello,
            "testo": testo,
            "stato": stato,
            "operativa": (wf.get("dates") or {}).get("data_prevista_operativita"),
        }
    print(f"Fibra: stato del piano pubblico per {len(out)} comuni")
    return out


# ------------------------------- Tipologia presa dal "gemello" di un altro sito
# Molti annunci (tipici di Trovit) arrivano senza descrizione: il titolo dice
# "Villa" e non c'è testo da leggere. Ma lo stesso immobile è spesso pubblicato
# anche su Casa.it o Subito CON la descrizione, che a volte lo smentisce
# ("porzione di bifamiliare"). Se l'accoppiamento è certo, si eredita.
def eredita_da_gemelli(annunci):
    con_desc = [a for a in annunci if (a.get("descr") or "").strip()]
    senza = [a for a in annunci if not (a.get("descr") or "").strip()]
    if not con_desc or not senza:
        return 0

    # chiave forte: stesso prezzo, stessi mq, stesso comune. Le chiavi che
    # corrispondono a più immobili diversi si scartano: meglio nessuna
    # informazione che una sbagliata.
    indice = {}
    for a in con_desc:
        if not (a.get("prezzo") and a.get("mq") and a.get("comune")):
            continue
        k = (a["prezzo"], a["mq"], a["comune"].strip().lower())
        indice.setdefault(k, []).append(a)

    n = 0
    for a in senza:
        if not (a.get("prezzo") and a.get("mq") and a.get("comune")):
            continue
        gemelli = indice.get((a["prezzo"], a["mq"], a["comune"].strip().lower()))
        if not gemelli or len(gemelli) != 1:
            continue
        g = gemelli[0]
        if g["tipo"] == a["tipo"]:
            a["avviso"] = None  # confermato da un'altra fonte: niente allarme
            continue
        a["tipo"] = g["tipo"]
        a["avviso"] = (f"Tipologia corretta leggendo lo stesso immobile su "
                       f"{g['fonte'].split(' · ')[0]}: là la descrizione dice "
                       f"«{g['tipo']}»")
        n += 1
    if n:
        print(f"Gemelli: {n} tipologie corrette con la descrizione di un altro sito")
    return n


# ------------------------------------------- Da quando è in giro un annuncio
# Casa.it non espone la data di pubblicazione. In mancanza, tengo traccia di
# quando l'ho visto io la prima volta: dopo qualche giro diventa un'ottima
# approssimazione di "quanto è vecchio".
CACHE_VISTI = ROOT / "scraper" / "visti_cache.json"


def segna_prima_visione(annunci):
    try:
        visti = json.loads(CACHE_VISTI.read_text("utf-8"))
    except (OSError, json.JSONDecodeError):
        visti = {}
    oggi = datetime.now(timezone.utc).date().isoformat()
    nuovi = 0
    for a in annunci:
        if a["id"] not in visti:
            visti[a["id"]] = oggi
            nuovi += 1
        a["visto"] = visti[a["id"]]
    vivi = {a["id"] for a in annunci}
    visti = {k: v for k, v in visti.items() if k in vivi}
    CACHE_VISTI.write_text(json.dumps(visti, ensure_ascii=False, indent=0), "utf-8")
    print(f"Prima visione: {nuovi} annunci nuovi, {len(visti)} tracciati")


# --------------------------------------------------- Pulizia del risultato
# Prezzo minimo credibile per una VENDITA: sotto questa soglia è quasi sempre
# un affitto mensile finito per errore tra gli annunci di vendita.
PREZZO_MIN_VENDITA = 20000


def firma(a):
    """Impronta del contenuto: lo stesso immobile ripubblicato (anche da
    agenzie diverse, con id diversi) ha titolo, prezzo e mq identici."""
    titolo = re.sub(r"\s+", " ", (a.get("titolo") or "").strip().lower())
    return (titolo, a.get("prezzo"), a.get("mq"))


def pulisci(annunci, contratto):
    """Toglie duplicati di contenuto e prezzi non credibili."""
    visti = {}
    unici = []
    n_dup = 0
    for a in annunci:
        f = firma(a)
        # firma debole (titolo vuoto o senza prezzo né mq): non deduplicare
        if not f[0] or (f[1] is None and f[2] is None):
            unici.append(a)
            continue
        if f in visti:
            n_dup += 1
            continue
        visti[f] = a
        unici.append(a)

    n_affitti = 0
    if contratto == "vendita":
        tenuti = []
        for a in unici:
            p = a.get("prezzo")
            if p is not None and p < PREZZO_MIN_VENDITA:
                n_affitti += 1
                continue
            tenuti.append(a)
        unici = tenuti

    if n_dup or n_affitti:
        print(f"Pulizia: {n_dup} duplicati, {n_affitti} prezzi da affitto rimossi")
    return unici


# ------------------------------------------------------------------- main
def main():
    config = json.loads((ROOT / "config" / "ricerche.json").read_text("utf-8"))
    tutte = []
    meta = []
    visti = set()  # dedup globale: lo stesso annuncio esce da più ricerche
    for ricerca in config["ricerche"]:
        annunci = []
        errori = []
        for nome, fn in (("Casa.it", scrape_casait), ("Subito.it", scrape_subito),
                         ("Trovit", scrape_trovit), ("Aste PVP", scrape_pvp)):
            try:
                trovati = fn(ricerca)
                annunci.extend(trovati)
                print(f"[{ricerca['id']}] {nome}: {len(trovati)} annunci")
            except Exception as e:  # una fonte giù non blocca le altre
                errori.append(f"{nome}: {e}")
                print(f"[{ricerca['id']}] {nome} ERRORE: {e}", file=sys.stderr)
        pmin, pmax = ricerca.get("prezzoMin"), ricerca.get("prezzoMax")
        if pmin or pmax:
            annunci = [a for a in annunci
                       if a["prezzo"] is None
                       or ((not pmin or a["prezzo"] >= pmin)
                           and (not pmax or a["prezzo"] <= pmax))]
        unici = []
        for a in annunci:
            if a["id"] not in visti:
                visti.add(a["id"])
                a["ricerca"] = ricerca["id"]
                unici.append(a)
        tutte.extend(unici)
        meta.append({"id": ricerca["id"], "label": ricerca["label"],
                     "contratto": ricerca["contratto"],
                     "count": len(unici), "errori": errori,
                     "linksEsterni": ricerca.get("linksEsterni") or []})

    # via i doppioni (stesso immobile ripubblicato) e i prezzi da affitto
    prima = len(tutte)
    tutte = pulisci(tutte, config["ricerche"][0]["contratto"])
    if len(tutte) != prima:
        for m in meta:  # il conteggio per ricerca va riallineato
            m["count"] = sum(1 for a in tutte if a.get("ricerca") == m["id"])

    # caratteristiche e zona PRIMA della classificazione: servono a dare
    # priorità AI alle case indipendenti nelle zone di Elisa.
    for a in tutte:
        a["comune"] = uniforma_comune(a.get("comune"))
        estrai_caratteristiche(a)
        a["zona"] = zona_preferita(a)
        a["tipo"] = classifica_regole(a["titolo"], a.get("descr") or "")["tipo"]
    classificatore = classifica_tutti(tutte) if tutte else "regole"
    if tutte:
        # dopo la classificazione: chi non ha descrizione eredita dal gemello
        eredita_da_gemelli(tutte)
        arricchisci_geo(tutte, config)
        segna_prima_visione(tutte)
        fibra = stato_fibra_comuni()
        for a in tutte:
            a["fibra"] = fibra.get(norm_comune(a.get("comune")))

    out = {
        "updated": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "classificatore": classificatore,
        "ricerche": meta,
        "annunci": tutte,
    }
    dest = ROOT / "data" / "annunci.json"
    dest.parent.mkdir(exist_ok=True)
    dest.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")),
                    "utf-8")
    print(f"Totale: {len(tutte)} annunci → {dest}")
    if not tutte:
        sys.exit(1)  # non committare un file vuoto se tutto è fallito


if __name__ == "__main__":
    main()
