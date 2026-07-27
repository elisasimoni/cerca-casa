# Notifiche di Cerca Casa

Servizio che avvisa il telefono quando compaiono case nuove che rientrano nella
ricerca. Sta su [Railway](https://railway.app) e funziona **ovunque tu sia**,
anche a Mac spento.

## Perché il server non fa lo scraping

I portali (Casa.it, Subito, Trovit) bloccano gli indirizzi dei datacenter —
verificato: da GitHub Actions rispondevano *403*. Railway è un datacenter,
quindi lo scraping resta sul Mac, che ha un indirizzo di casa.

Il giro completo è questo:

```
Mac (rete di casa)  ──scraping──►  data/annunci.json su GitHub Pages
                                            │
                                            │ legge ogni 15 minuti
                                            ▼
                                   Railway (questo servizio)
                                            │
                                            │ Web Push
                                            ▼
                                      il tuo iPhone
```

Il Mac serve solo per **raccogliere** gli annunci (3 volte al giorno). Il server
li **guarda** di continuo e ti avvisa: se il Mac è spento non arrivano annunci
nuovi da segnalare, ma il servizio resta vivo e non perde le iscrizioni.

## Come metterlo online (una volta sola)

```bash
npm install -g @railway/cli
railway login
cd ~/Desktop/Progetti/cerca-casa/server
railway init
railway up
```

Poi sul sito di Railway, nel progetto appena creato:

1. **Settings → Networking → Generate Domain**: ti dà un indirizzo tipo
   `cerca-casa-notifiche-production.up.railway.app`. Copialo.
2. **Data → Add Volume**, montato su `/data`. Serve a non perdere l'iscrizione
   del telefono a ogni riavvio: senza, dopo un aggiornamento le notifiche
   smettono di arrivare in silenzio.

Infine, nell'app: **Altro → Notifiche**, incolla l'indirizzo e premi **Attiva**.
Arriva subito una notifica di prova.

> Su iPhone le notifiche funzionano **solo se l'app è sulla schermata Home**
> (in Safari: Condividi → Aggiungi a Home). È una regola di iOS, non dell'app.

## Cosa ti viene notificato

Solo quello che stai cercando davvero: quando premi *Attiva*, l'app manda anche
i filtri che hai impostato in quel momento (tipologia, prezzo massimo, zona,
evita-centri). Se li cambi, ripremi *Attiva* per aggiornarli.

Senza filtri riceveresti ~90 annunci nuovi al giorno, e dopo due giorni
spegneresti le notifiche.

## Variabili d'ambiente (tutte facoltative)

| Nome | Cosa fa | Predefinito |
|---|---|---|
| `DATI_URL` | Da dove legge gli annunci | il JSON su GitHub Pages |
| `CONTROLLA_OGNI_MINUTI` | Ogni quanto guarda | `15` |
| `STORAGE_DIR` | Dove salva iscrizioni e chiavi | `/data` |
| `VAPID_PUBLIC` / `VAPID_PRIVATE` | Chiavi di firma | generate e salvate al primo avvio |

## Verificare che stia funzionando

```bash
curl https://IL-TUO-INDIRIZZO.up.railway.app/stato
```

Risponde con quanti telefoni sono iscritti, quando ha guardato l'ultima volta e
com'è andata. Per forzare un controllo subito:

```bash
curl -X POST https://IL-TUO-INDIRIZZO.up.railway.app/controlla
```
