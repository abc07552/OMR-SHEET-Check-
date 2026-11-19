"""Optional isolated QA PostgreSQL. Never install/use pgserver in production.

Install: .venv/bin/pip install -r backend/requirements-postgres-test.in
Run as a background process: .venv/bin/python scripts/local-postgres.py
The connection URI is written to .cache/qa/postgres-url (not committed).
"""

import signal
from pathlib import Path

import pgserver

root = Path(__file__).resolve().parent.parent
path = root / ".cache/qa"
path.mkdir(parents=True, exist_ok=True)
server = pgserver.get_server(path / "postgres", cleanup_mode="stop")
uri = server.get_uri()
(path / "postgres-url").write_text(uri)
print("QA PostgreSQL ready on a private Unix socket.", flush=True)
print(server.psql("SELECT version();"), flush=True)


def stop(*_):
    server.cleanup()
    raise SystemExit(0)


signal.signal(signal.SIGTERM, stop)
signal.signal(signal.SIGINT, stop)
signal.pause()
