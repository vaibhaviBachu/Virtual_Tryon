"""
Worker-side database session, mirroring apps/api/db/session.py but built from
WorkerSettings (workers/config.py) rather than apps.api.core.config — the worker must
never import from apps.api (see db/base.py for why models are shared but sessions
are not).
"""
import logging
from contextlib import contextmanager
from typing import Generator

from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from workers.config import get_worker_settings

logger = logging.getLogger("worker.db")

settings = get_worker_settings()

engine = create_engine(settings.DATABASE_URL, pool_pre_ping=True, future=True)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True)


@contextmanager
def session_scope() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()
