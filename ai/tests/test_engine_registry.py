import pytest

from ai.engines.base import RenderResult
from ai.engines.not_implemented import NotImplementedEngine
from ai.engines.registry import get_engine, register_engine


def test_default_engine_is_not_implemented():
    engine = get_engine()
    assert isinstance(engine, NotImplementedEngine)


def test_not_implemented_engine_never_fabricates_a_result():
    engine = NotImplementedEngine()
    result = engine.render(b"fake-user-photo", b"fake-jewellery-asset", {})
    assert isinstance(result, RenderResult)
    assert result.success is False
    assert result.result_image_bytes is None
    assert result.error_message


def test_unknown_engine_name_raises():
    with pytest.raises(ValueError):
        get_engine("does-not-exist")


def test_register_and_retrieve_custom_engine():
    class DummyEngine(NotImplementedEngine):
        engine_name = "dummy"

    register_engine("dummy", DummyEngine())
    assert get_engine("dummy").engine_name == "dummy"
