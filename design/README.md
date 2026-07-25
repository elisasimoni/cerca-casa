# Cerca Casa — Design System

Componenti reali della PWA [Cerca Casa](https://elisasimoni.github.io/cerca-casa/),
derivati dai token di **Casa & Vita** (stessa famiglia di app: crema, rame, marrone caldo).

| File | Contenuto |
|---|---|
| `colori.html` | Token di superficie, testo, primario rame e accenti semantici |
| `tipografia.html` | Scala tipografica e stili semantici (titoli, prezzo, meta, etichette) |
| `bottoni.html` | Bottoni, azioni nella card, pulsante flottante |
| `badge.html` | Badge tipologia, provenienza, stato trattativa, tag caratteristiche, avvisi |
| `card-annuncio.html` | La card compatta della lista (282 px): foto, azioni in sovrimpressione, quattro righe |
| `schermata-lista.html` | Testa della lista sempre visibile, riga chip e barra di navigazione |
| `filtri.html` | Chip zone, campi con etichetta, scelte in parole, area disegnata |
| `navigazione.html` | Barra inferiore, schermata PIN, stato vuoto |
| `_tokens.css` | Token condivisi dalle anteprime |

## Principi

1. **Il colore classifica.** Verde = casa indipendente (quello che cerchiamo), ambra = porzione o avviso,
   blu = appartamento. Si capisce la tipologia prima di leggere.
2. **Ogni campo dice cosa è.** Le etichette restano sopra i campi anche da compilati: un "250" senza
   etichetta non significa niente.
3. **Parole, non unità.** "Solo pianura" invece di "altitudine max 100 m"; "entro 30 minuti" invece di
   una soglia in secondi.
4. **Dire la verità sugli annunci.** Quando titolo e descrizione si contraddicono compare un avviso
   arancione: l'app non nasconde ciò che i portali addolciscono.
5. **Una sola azione primaria per schermata**, in rame pieno.
6. **I risultati prima dei controlli.** La schermata si apre sulla lista e mostra due annunci interi
   senza scorrere; i filtri stanno in un pannello a schermo intero, richiamato da un'icona.
   Restano sempre in vista solo tre cose: quanti risultati, quando aggiornati, come intervenire.
7. **Nessun filtro invisibile.** Ciò che è acceso si vede come chip rimovibile, e i chip zona
   portano il conteggio: un filtro che esclude in silenzio fa sembrare l'app rotta.
