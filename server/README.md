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

## È già online

Progetto Railway `cerca-casa-notifiche`, servizio `notifiche`, volume su `/data`:

**https://notifiche-production.up.railway.app**

L'indirizzo è già scritto nell'app, quindi in **Altro → Notifiche** c'è solo il
pulsante **Attiva le notifiche**.

> Su iPhone le notifiche funzionano **solo se l'app è sulla schermata Home**
> (in Safari: Condividi → Aggiungi a Home). È una regola di iOS, non dell'app.

Il volume su `/data` non è un dettaglio: ci stanno le chiavi VAPID e le
iscrizioni dei telefoni. Senza, a ogni riavvio le notifiche smetterebbero di
arrivare senza dire niente.

## Rimetterlo online dopo una modifica

```bash
cd ~/Desktop/Progetti/cerca-casa/server && railway up --ci
```

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
