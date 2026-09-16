import pytest

from apps.api.core.security import (
    create_access_token,
    decode_token,
    hash_password,
    verify_password,
)


def test_password_hash_roundtrip():
    hashed = hash_password("correct horse battery staple")
    assert verify_password("correct horse battery staple", hashed)
    assert not verify_password("wrong password", hashed)


def test_password_hash_is_not_plaintext():
    hashed = hash_password("secret")
    assert hashed != "secret"


def test_jwt_roundtrip():
    token = create_access_token(subject="user-123", extra_claims={"role": "customer"})
    payload = decode_token(token)
    assert payload["sub"] == "user-123"
    assert payload["role"] == "customer"
    assert payload["type"] == "access"


def test_jwt_rejects_tampered_token():
    token = create_access_token(subject="user-123")
    tampered = token[:-1] + ("A" if token[-1] != "A" else "B")
    with pytest.raises(Exception):
        decode_token(tampered)
