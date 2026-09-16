"""
FastAPI auth dependencies, built entirely on the Milestone 1 security primitives
(core/security.py's create_access_token/decode_token). No second authentication system —
per the Milestone 2 spec's explicit instruction.

`get_current_user` reads and validates the bearer token and loads the User row.
`require_admin` builds on it to reject anything but role=admin, and is the dependency
every catalogue mutation route (create/update/archive category or jewellery, asset
upload/replace/delete) uses.
"""
import logging

import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from apps.api.core.security import decode_token
from apps.api.db.session import get_db
from db.models import User, UserRole

logger = logging.getLogger("app.auth")

_bearer_scheme = HTTPBearer(auto_error=False)


def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer_scheme),
    db: Session = Depends(get_db),
) -> User:
    if credentials is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    try:
        payload = decode_token(credentials.credentials)
    except jwt.PyJWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    if payload.get("type") != "access":
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token type.")

    user_id = payload.get("sub")
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found.")
    return user


def get_current_user_optional(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer_scheme),
    db: Session = Depends(get_db),
) -> User | None:
    """Milestone 3: guest try-on sessions are a first-class, spec-required case (no
    forced registration). Endpoints that must work for both guests and logged-in
    customers depend on this instead of `get_current_user` — it returns None rather
    than raising 401 when no/invalid credentials are supplied, and still returns the
    real user when a valid token IS supplied (so an authenticated customer's session
    can still be tied to their account for e.g. try-on history in a later milestone)."""
    if credentials is None:
        return None
    try:
        payload = decode_token(credentials.credentials)
    except jwt.PyJWTError:
        return None
    if payload.get("type") != "access":
        return None
    return db.get(User, payload.get("sub"))


def require_admin(current_user: User = Depends(get_current_user)) -> User:
    if current_user.role != UserRole.admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This action requires an administrator account.",
        )
    return current_user
