# 🏠 Cerca Casa

PWA personale per organizzare la ricerca casa: annunci salvati per zona con prezzo, indirizzo, metri quadri, locali e stato della trattativa, più i link di ricerca rapida su tutti i principali portali immobiliari italiani.

**App:** https://elisasimoni.github.io/cerca-casa/

## Funzioni

- 📰 **Annunci automatici**: uno scraper (GitHub Actions, 3 volte al giorno) scarica gli annunci reali da **Casa.it** e **Subito.it** per le ricerche configurate in `config/ricerche.json` e li pubblica in `data/annunci.json`; l'app li mostra con filtri, foto, prezzo, €/mq e "Salva" per portarli tra le proprie case. Immobiliare.it, Idealista e Wikicasa bloccano le richieste automatiche (403 anti-bot) e restano disponibili come link rapidi nel tab Portali.
- 🔒 Accesso con PIN (nel codice c'è solo l'hash SHA-256, mai il PIN in chiaro)
- 🏠 Lista case raggruppate per zona, con prezzo, €/mq, mq, locali, bagni, piano
- 📍 Indirizzo cliccabile → si apre su Google Maps
- 🏷️ Stato per ogni casa: da valutare, contattata, visita fissata, visitata, ⭐ preferita, scartata
- 🔍 Ricerca rapida per zona su Immobiliare.it, Idealista, Casa.it, Subito.it, Wikicasa, Trovit, Bakeca e Google (compra o affitto)
- 📲 Installabile come app (PWA) e funziona offline
- 💾 Dati in localStorage sul dispositivo + esporta/importa backup JSON

## Struttura

```
cerca-casa/
├── index.html       # App shell
├── css/style.css    # Stile (tema chiaro)
├── js/app.js        # Logica: PIN, case, zone, portali, backup
├── manifest.json    # Manifest PWA
├── sw.js            # Service worker (offline)
└── icons/           # Icone PWA
```

## Nota sulla privacy

Il sito è pubblico su GitHub Pages: il PIN tiene lontani i curiosi, ma non è una protezione forte (il codice è visibile a chiunque). I dati delle case però **non sono nel repo**: restano solo in localStorage del dispositivo.
