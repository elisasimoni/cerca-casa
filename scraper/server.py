#!/usr/bin/env python3
"""Helper locale per Cerca Casa.

Piccolo server su 127.0.0.1:8787 (solo questo Mac). L'app su GitHub Pages lo
chiama col bottone "Aggiorna ora": lancia lo scraper (fonti + classificazione),
pubblica i dati su GitHub e restituisce subito il JSON fresco all'app.
Gestito da launchd (com.elisa.cerca-casa-server, KeepAlive).
"""
import json
import subprocess
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LOCK = threading.Lock()


class Handler(BaseHTTPRequestHandler):

    def _rispondi(self, code, payload):
        corpo = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Content-Length", str(len(corpo)))
        self.end_headers()
        self.wfile.write(corpo)

    def do_OPTIONS(self):
        self._rispondi(200, {"ok": True})

    def do_GET(self):
        if self.path == "/ping":
            self._rispondi(200, {"ok": True})
        else:
            self._rispondi(404, {"errore": "non trovato"})

    def do_POST(self):
        if self.path != "/aggiorna":
            self._rispondi(404, {"errore": "non trovato"})
            return
        if not LOCK.acquire(blocking=False):
            self._rispondi(409, {"errore": "aggiornamento già in corso"})
            return
        try:
            res = subprocess.run(["/bin/zsh", str(ROOT / "scraper" / "aggiorna.sh")],
                                 capture_output=True, text=True, timeout=280)
            dati = json.loads((ROOT / "data" / "annunci.json").read_text("utf-8"))
            if res.returncode != 0:
                dati.setdefault("ricerche", [])
                print("aggiorna.sh exit", res.returncode, res.stderr[-300:])
            self._rispondi(200, dati)
        except Exception as e:
            self._rispondi(500, {"errore": str(e)})
        finally:
            LOCK.release()

    def log_message(self, fmt, *args):
        print(self.address_string(), fmt % args)


if __name__ == "__main__":
    ThreadingHTTPServer(("127.0.0.1", 8787), Handler).serve_forever()
