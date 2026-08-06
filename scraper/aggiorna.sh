#!/bin/zsh
# Aggiorna gli annunci e pubblica su GitHub Pages.
# Eseguito automaticamente da launchd (com.elisa.cerca-casa-annunci) 3 volte al giorno.
set -e
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"

REPO="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO"

echo "=== $(date '+%Y-%m-%d %H:%M:%S') avvio aggiornamento"

# I file che lo scraper riscrive a ogni giro: si buttano prima di sincronizzare
# e si pubblicano tutti insieme dopo. Devono essere lo stesso elenco nei due
# posti: visti_cache.json era rimasto fuori, restava sporco per sempre e da
# solo bloccava il pull — quindi il push — di tutti i giri successivi.
DATI=(data/annunci.json scraper/tipi_cache.json scraper/geo_cache.json scraper/visti_cache.json)

if ! git fetch --quiet origin; then
  echo "Non riesco a leggere GitHub (rete assente?): non pubblico niente."
  exit 0
fi
# Questa copia non ha lavoro suo da difendere: riparte sempre da quello che c'è
# online, appena scaricato. Prima si tentava un pull --rebase con un reset di
# riserva su origin/main, ma senza fetch quel riferimento era vecchio: il bot
# committava su una base sorpassata e il push veniva respinto ogni volta.
git checkout -- "${DATI[@]}" 2>/dev/null || true
git reset --hard origin/main --quiet

if ! python3 scraper/scrape.py; then
  echo "Scraper fallito (offline o portali giù): non committo nulla."
  exit 0
fi

# Rete di sicurezza: mai pubblicare un JSON rotto (l'app smetterebbe di
# funzionare finché non arriva il giro successivo).
for f in "${DATI[@]}"; do
  [ -f "$f" ] || continue
  if ! python3 -c "import json,sys; json.load(open(sys.argv[1]))" "$f"; then
    echo "ERRORE: $f non è JSON valido — non pubblico niente."
    git checkout -- data/ scraper/ 2>/dev/null || true
    exit 1
  fi
done

# Controllo di merito: un file valido ma quasi vuoto è comunque sospetto.
N=$(python3 -c "import json;print(len(json.load(open('data/annunci.json'))['annunci']))")
if [ "$N" -lt 50 ]; then
  echo "ERRORE: solo $N annunci, sembra un giro andato male — non pubblico."
  git checkout -- data/ scraper/ 2>/dev/null || true
  exit 1
fi

if git diff --quiet -- "${DATI[@]}"; then
  echo "Nessun cambiamento negli annunci."
else
  git add "${DATI[@]}"
  git commit --quiet -m "Aggiorna annunci ($(date '+%Y-%m-%d %H:%M') · $N annunci)"
  # Se nel frattempo è arrivato altro su GitHub il push viene respinto: si
  # riprova una volta sola ripartendo dal remoto, invece di restare indietro
  # per sempre come è successo dal 27 luglio in poi.
  if ! git push --quiet; then
    echo "Push respinto: risincronizzo e riprovo."
    git fetch --quiet origin
    git rebase --quiet origin/main || { git rebase --abort 2>/dev/null || true; exit 1; }
    git push --quiet
  fi
  echo "Annunci pubblicati: $N annunci."
fi
