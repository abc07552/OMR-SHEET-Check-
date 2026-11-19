from pathlib import Path

from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from .config import ROOT, Settings


def engine_for(settings: Settings):
    settings.data_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
    sqlite = settings.database_url.startswith("sqlite")
    options = (
        {"connect_args": {"check_same_thread": False, "timeout": 20}}
        if sqlite
        else {"pool_pre_ping": True, "pool_size": 5, "max_overflow": 5}
    )
    if settings.database_url.endswith(":memory:"):
        options["poolclass"] = StaticPool
    engine = create_engine(settings.database_url, **options)
    if sqlite:

        @event.listens_for(engine, "connect")
        def pragmas(connection, _):
            connection.execute("PRAGMA foreign_keys=ON")
            connection.execute("PRAGMA busy_timeout=20000")
            connection.execute("PRAGMA journal_mode=WAL")

    return engine


def migrate(engine, revision="head"):
    config = Config(str(ROOT / "alembic.ini"))
    config.set_main_option("script_location", str(ROOT / "backend/migrations"))
    with engine.begin() as connection:
        config.attributes["connection"] = connection
        command.upgrade(config, revision)
    if engine.url.get_backend_name() == "sqlite" and engine.url.database:
        path = Path(engine.url.database)
        if path.exists():
            path.chmod(0o600)


def sessions_for(engine):
    return sessionmaker(bind=engine, expire_on_commit=False)
