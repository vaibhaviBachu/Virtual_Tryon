#!/usr/bin/env python3
"""
Create (or update) an admin user for testing Milestone 2's admin-only catalogue
endpoints.

There is no self-service registration endpoint (deliberately out of scope for
Milestone 2 — see Milestone 2 spec's narrow auth scope: login + /me only). This script
is the only way to get an initial admin account, using the same password hashing
(passlib/argon2) and User model the real login endpoint checks against — no parallel
auth mechanism.

Usage:
    python scripts/seed_admin.py --email admin@example.com --password 'change-me-now'

Idempotent: running it again for the same email updates the password and ensures the
role is 'admin' rather than creating a duplicate (email is unique).
"""
import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from apps.api.core.security import hash_password  # noqa: E402
from apps.api.db.session import SessionLocal  # noqa: E402
from db.models import User, UserRole  # noqa: E402


def seed_admin(email: str, password: str) -> None:
    db = SessionLocal()
    try:
        user = db.query(User).filter(User.email == email).first()
        if user is None:
            user = User(email=email, password_hash=hash_password(password), role=UserRole.admin)
            db.add(user)
            action = "Created"
        else:
            user.password_hash = hash_password(password)
            user.role = UserRole.admin
            action = "Updated"
        db.commit()
        print(f"{action} admin user: {email}")
    finally:
        db.close()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--email", required=True)
    parser.add_argument("--password", required=True)
    args = parser.parse_args()

    if len(args.password) < 8:
        print("Refusing to seed an admin with a password shorter than 8 characters.", file=sys.stderr)
        sys.exit(1)

    seed_admin(args.email, args.password)


if __name__ == "__main__":
    main()
