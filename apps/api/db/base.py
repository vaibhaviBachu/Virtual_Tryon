"""
Shared SQLAlchemy declarative base.

Milestone 2's models (JewelleryCategory, Jewellery, JewelleryAsset, TryonSession,
TryonRequest, User) will import `Base` from here so Alembic autogenerate can see all
of them from a single metadata object. No models are defined yet in Milestone 1.
"""
from sqlalchemy.orm import DeclarativeBase


class Base(DeclarativeBase):
    pass
