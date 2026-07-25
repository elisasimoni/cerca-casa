#!/bin/zsh
# Aggiorna gli annunci e pubblica su GitHub Pages.
# Eseguito automaticamente da launchd (com.elisa.cerca-casa-annunci) 3 volte al giorno.
set -e
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"

REPO="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO"

echo "=== $(date '+%Y-%m-%d %H:%M:%S') avvio aggiornamento"

# --autostash può lasciare marcatori di conflitto dentro i file: meglio
# buttare le modifiche locali ai dati (li rigenera lo scraper) e ripartire
# puliti dal remoto.
git checkout -- data/ scraper/tipi_cache.json scraper/geo_cache.json 2>/dev/null || true
git pull --rebase --quiet || { git rebase --abort 2>/dev/null || true; git reset --hard origin/main --quiet; }

if ! python3 scraper/scrape.py; then
  echo "Scraper fallito (offline o portali giù): non committo nulla."
  exit 0
fi

# Rete di sicurezza: mai pubblicare un JSON rotto (l'app smetterebbe di
# funzionare finché non arriva il giro successivo).
for f in data/annunci.json scraper/tipi_cache.json scraper/geo_cache.json; do
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

if git diff --quiet -- data/annunci.json scraper/tipi_cache.json scraper/geo_cache.json; then
  echo "Nessun cambiamento negli annunci."
else
  git add data/annunci.json scraper/tipi_cache.json scraper/geo_cache.json
  git commit --quiet -m "Aggiorna annunci ($(date '+%Y-%m-%d %H:%M') · $N annunci)"
  git push --quiet
  echo "Annunci pubblicati: $N annunci."
fi
