#!/bin/zsh
# Aggiorna gli annunci e pubblica su GitHub Pages.
# Eseguito automaticamente da launchd (com.elisa.cerca-casa-annunci) 3 volte al giorno.
set -e
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"

REPO="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO"

echo "=== $(date '+%Y-%m-%d %H:%M:%S') avvio aggiornamento"

git pull --rebase --quiet || true

if ! python3 scraper/scrape.py; then
  echo "Scraper fallito (offline o portali giù): non committo nulla."
  exit 0
fi

if git diff --quiet -- data/annunci.json scraper/tipi_cache.json; then
  echo "Nessun cambiamento negli annunci."
else
  git add data/annunci.json scraper/tipi_cache.json
  git commit --quiet -m "Aggiorna annunci ($(date '+%Y-%m-%d %H:%M'))"
  git push --quiet
  echo "Annunci pubblicati."
fi
