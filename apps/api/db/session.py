"""
Database engine/session management.

`get_db` is a FastAPI dependency that yields a request-scoped session and always closes
it. `check_database_connection` is used by the /ready endpoint and is intentionally
side-effect-free and cheap (a single `SELECT 1`).
"""
import logging
from contextlib import contextmanager
from typing import Generator

from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session, sessionmaker

from apps.api.core.config import get_settings

logger = logging.getLogger("app.db")

settings = get_settings()

engine = create_engine(settings.DATABASE_URL, pool_pre_ping=True, future=True)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True)


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


@contextmanager
def session_scope() -> Generator[Session, None, None]:
    """For use outside of FastAPI's DI system (e.g. worker processes)."""
    db = SessionLocal()
    try:
        yield db
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def check_database_connection() -> bool:
    try:
        with engine.connect() as connection:
            connection.execute(text("SELECT 1"))
        return True
    except Exception:
        logger.warning("Database readiness check failed", exc_info=True)
        return False
