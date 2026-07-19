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
from datetime import datetime, timezone
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
        state = casait_state(fetch(url))
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
                "descr": (it.get("description") or "")[:180],
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
            "descr": (ad.get("body") or "")[:180].replace("\n", " "),
        })
    return out


# ----------------------------------------------------------------- Trovit
# Aggregatore: contiene anche gli annunci di Immobiliare.it/Idealista (che
# bloccano lo scraping diretto). Ogni card dichiara il portale d'origine in
# <small>: scartiamo quelli di Casa.it/Subito perché già presi direttamente.
FONTI_GIA_COPERTE = {"CASA.IT", "SUBITO", "SUBITO.IT"}


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
        "data": None,
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
        html = fetch(url)
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
            "descr": extra + " — " + (lotto.get("descLotto") or "")[:150],
        })
    return out


# ------------------------------------------------------------------- main
def main():
    config = json.loads((ROOT / "config" / "ricerche.json").read_text("utf-8"))
    tutte = []
    meta = []
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
        visti = set()
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

    out = {
        "updated": datetime.now(timezone.utc).isoformat(timespec="seconds"),
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
