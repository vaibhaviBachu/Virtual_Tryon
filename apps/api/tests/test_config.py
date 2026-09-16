from apps.api.core.config import Settings, get_settings


def test_settings_load_from_env(monkeypatch):
    monkeypatch.setenv("APP_NAME", "test-app")
    monkeypatch.setenv("API_PORT", "9999")
    settings = Settings()
    assert settings.APP_NAME == "test-app"
    assert settings.API_PORT == 9999


def test_settings_rejects_invalid_environment(monkeypatch):
    monkeypatch.setenv("ENVIRONMENT", "not-a-real-environment")
    try:
        Settings()
        assert False, "expected a validation error"
    except Exception as exc:
        assert "ENVIRONMENT" in str(exc)


def test_get_settings_is_cached():
    assert get_settings() is get_settings()


def test_cors_origins_are_parsed_as_list(monkeypatch):
    monkeypatch.setenv("CORS_ALLOWED_ORIGINS", "http://a.com, http://b.com")
    settings = Settings()
    assert settings.cors_allowed_origins_list == ["http://a.com", "http://b.com"]
