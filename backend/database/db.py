"""
Database engine / session setup.

    DATABASE_URL   e.g. postgresql+psycopg://user:pass@host:5432/queue_db  (env var)
                   defaults to a local SQLite file for quick dev, no Postgres required.

Two ways to get a session:
    get_db()        - FastAPI dependency, one Session per request, closed afterwards
    session_scope() - context manager for scripts (seed.py, ML jobs, one-off tasks);
                       commits on success, rolls back and re-raises on error
"""
import os
from contextlib import contextmanager
from typing import Generator

from sqlalchemy import create_engine, event
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker

DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./queue.db")

connect_args = {"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {}

engine = create_engine(
    DATABASE_URL,
    echo=os.getenv("SQL_ECHO", "false").lower() == "true",
    pool_pre_ping=True,
    connect_args=connect_args,
)


# SQLite doesn't enforce FOREIGN KEY constraints unless told to. Harmless on Postgres.
@event.listens_for(Engine, "connect")
def _set_sqlite_pragma(dbapi_connection, connection_record) -> None:
    if DATABASE_URL.startswith("sqlite"):
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()


SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, expire_on_commit=False)


def get_db() -> Generator[Session, None, None]:
    """FastAPI dependency: `db: Session = Depends(get_db)`."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


@contextmanager
def session_scope() -> Generator[Session, None, None]:
    """Script-style session: `with session_scope() as db: ...`."""
    db = SessionLocal()
    try:
        yield db
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()
