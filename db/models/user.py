"""
Minimal User model, introduced in Milestone 2 (not Milestone 1) because catalogue
mutation endpoints must be admin-only per the Milestone 2 spec, and enforcing that
requires *some* persisted notion of "who is this request from." Full account features
(registration, password reset, profile) remain Milestone 7 scope — this model exists
only to make `role = admin` a real, checkable thing rather than a TODO.

Auth uses the existing Milestone 1 security primitives (`apps/api/core/security.py`'s
`hash_password`/`verify_password`/`create_access_token`/`decode_token`) — no second
authentication system.
"""
import enum

from sqlalchemy import Enum, String
from sqlalchemy.orm import Mapped, mapped_column

from db.base import Base
from db.mixins import TimestampMixin, UUIDPrimaryKeyMixin


class UserRole(str, enum.Enum):
    customer = "customer"
    admin = "admin"


class User(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "users"

    email: Mapped[str] = mapped_column(String(320), unique=True, nullable=False, index=True)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    role: Mapped[UserRole] = mapped_column(
        Enum(UserRole, name="user_role", native_enum=False, length=20),
        nullable=False,
        default=UserRole.customer,
        server_default=UserRole.customer.value,
    )
