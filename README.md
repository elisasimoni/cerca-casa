# 🏠 Cerca Casa

PWA personale per organizzare la ricerca casa: annunci salvati per zona con prezzo, indirizzo, metri quadri, locali e stato della trattativa, più i link di ricerca rapida su tutti i principali portali immobiliari italiani.

**App:** https://elisasimoni.github.io/cerca-casa/

## Funzioni

- 📰 **Annunci automatici**: uno scraper (GitHub Actions, 3 volte al giorno) scarica gli annunci reali da **Casa.it** e **Subito.it** per le ricerche configurate in `config/ricerche.json` e li pubblica in `data/annunci.json`; l'app li mostra con filtri, foto, prezzo, €/mq e "Salva" per portarli tra le proprie case. Immobiliare.it, Idealista e Wikicasa bloccano le richieste automatiche (403 anti-bot) e restano disponibili come link rapidi nel tab Portali.
- 🔒 Accesso con PIN (nel codice c'è solo l'hash SHA-256, mai il PIN in chiaro)
- 🏠 Lista case raggruppate per zona, con prezzo, €/mq, mq, locali, bagni, piano
- 📍 Indirizzo cliccabile → si apre su Google Maps
- 🏷️ Stato per ogni casa: da valutare, contattata, visita fissata, visitata, ⭐ preferita, scartata
- 👟 **Visite**: dopo aver visto una casa si segnano i pro, i contro e il verdetto (✅ promossa, 🤔 in forse, ❌ bocciata); il verdetto aggiorna da solo lo stato della casa salvata
- 🔍 Ricerca rapida per zona su Immobiliare.it, Idealista, Casa.it, Subito.it, Wikicasa, Trovit, Bakeca e Google (compra o affitto)
- 📲 Installabile come app (PWA) e funziona offline
- 💾 Dati in localStorage sul dispositivo + esporta/importa backup JSON
- ☁️ **Salvataggio online** (Supabase, progetto `casa-vita`): case, visite, zone e ricerche salvate viaggiano anche online, così non si perdono svuotando Safari e iPhone e Mac vedono le stesse cose. Il cassetto è riconosciuto da un codice lungo generato dal browser — nel repo pubblico ci sono solo indirizzo e chiave pubblica del progetto, che da soli non aprono niente

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

Il sito è pubblico su GitHub Pages: il PIN tiene lontani i curiosi, ma non è una protezione forte (il codice è visibile a chiunque). I dati delle case **non sono nel repo**: stanno in localStorage del dispositivo e, se accendi il salvataggio online, in una riga su Supabase riconosciuta dal *codice del cassetto*.

Quel codice è l'unica cosa che protegge i dati online, quindi: non è ricavato dal PIN (del PIN nel repo c'è l'impronta, e un PIN corto si indovina in un attimo a partire da quella), lo genera il browser a caso ed è lungo 48 caratteri. La tabella ha RLS acceso e nessuna policy: con la chiave pubblica non si legge niente in diretta, si passa solo da due funzioni che pretendono il codice giusto. Chi ha il codice vede tutto: va trattato come una password.
