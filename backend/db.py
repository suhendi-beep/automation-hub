import os
from contextlib import contextmanager

from sqlalchemy import create_engine, text
from sqlalchemy.engine import URL
from sqlalchemy.orm import DeclarativeBase, sessionmaker


def database_url():
    explicit = (os.getenv("DATABASE_URL") or "").strip()
    if explicit:
        return explicit

    try:
        port = int(os.getenv("DB_PORT", "5432"))
    except ValueError:
        port = 5432

    return URL.create(
        "postgresql+psycopg",
        username=os.getenv("DB_USER", "automation"),
        password=os.getenv("DB_PASSWORD", ""),
        host=os.getenv("DB_HOST", "db"),
        port=port,
        database=os.getenv("DB_NAME", "automation_hub"),
    )


class Base(DeclarativeBase):
    pass


_url = database_url()
_engine_kwargs = {"pool_pre_ping": True}
if not str(_url).startswith("sqlite"):
    _engine_kwargs.update({
        "pool_size": int(os.getenv("DB_POOL_SIZE", "5")),
        "max_overflow": int(os.getenv("DB_MAX_OVERFLOW", "10")),
        "pool_timeout": int(os.getenv("DB_POOL_TIMEOUT", "30")),
        "pool_recycle": 1800,
    })

engine = create_engine(_url, **_engine_kwargs)
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


@contextmanager
def session_scope():
    session = SessionLocal()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def check_db():
    with engine.connect() as conn:
        conn.execute(text("SELECT 1"))
    return True
