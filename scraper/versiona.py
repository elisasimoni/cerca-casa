#!/usr/bin/env python3
"""Stampa nell'index (e nel service worker) l'impronta dei file css/js.

Da lanciare prima di ogni push: garantisce che browser e service worker
prendano la versione nuova, senza aspettare la cache di GitHub Pages.
"""
import hashlib
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FILE_VERSIONATI = ["css/style.css", "js/app.js", "vendor/leaflet.js", "vendor/leaflet.css"]


def impronta(rel):
    return hashlib.md5((ROOT / rel).read_bytes()).hexdigest()[:8]


def main():
    versioni = {rel: impronta(rel) for rel in FILE_VERSIONATI}

    html = (ROOT / "index.html").read_text("utf-8")
    for rel, v in versioni.items():
        html = re.sub(rf'{re.escape(rel)}(\?v=[a-z0-9]+)?"', f'{rel}?v={v}"', html)
    (ROOT / "index.html").write_text(html, "utf-8")

    sw = (ROOT / "sw.js").read_text("utf-8")
    for rel, v in versioni.items():
        sw = re.sub(rf"'\./{re.escape(rel)}(\?v=[a-z0-9]+)?'", f"'./{rel}?v={v}'", sw)
    globale = hashlib.md5("".join(versioni.values()).encode()).hexdigest()[:8]
    sw = re.sub(r"const CACHE = 'cercacasa-[^']+';",
                f"const CACHE = 'cercacasa-{globale}';", sw)
    (ROOT / "sw.js").write_text(sw, "utf-8")

    print("versioni:", ", ".join(f"{k}={v}" for k, v in versioni.items()))
    print("cache:", f"cercacasa-{globale}")


if __name__ == "__main__":
    main()
