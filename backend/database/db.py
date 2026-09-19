"""
Database engine / session setup - PostgreSQL only.

    DATABASE_URL   postgresql+psycopg://user:pass@host:5432/queue_db   (required)

Two ways to get a session:
    get_db()        - FastAPI dependency, one Session per request, closed afterwards
    session_scope() - context manager for scripts (seed.py, ML jobs, one-off tasks);
                       commits on success, rolls back and re-raises on error
"""
import os
from contextlib import contextmanager
from typing import Generator

from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

DATABASE_URL = os.getenv("DATABASE_URL")
if not DATABASE_URL:
    raise RuntimeError(
        "DATABASE_URL is not set. Expected a Postgres URL, e.g. "
        "postgresql+psycopg://queue_user:queue_pass@localhost:5432/queue_db "
        "(see docker-compose.yml for the local-dev value)."
    )

engine = create_engine(
    DATABASE_URL,
    echo=os.getenv("SQL_ECHO", "false").lower() == "true",
    pool_pre_ping=True,
)

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