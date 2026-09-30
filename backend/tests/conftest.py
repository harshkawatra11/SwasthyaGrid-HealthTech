"""Test isolation. The environment is set at import time, before any test module
constructs `TestClient(app)`, because environment variables override backend/.env
in pydantic-settings and a fixture would run too late."""

import os
import tempfile
from pathlib import Path

os.environ.update(
    {
        "DATA_SOURCE": "seed",
        "LOGISTICS_TICK": "false",
        "GEMINI_API_KEY": "",
        "SARVAM_API_KEY": "",
        "LOGISTICS_SERVICE_TOKEN": "test-token",
        "LOGISTICS_STATE_PATH": str(Path(tempfile.mkdtemp()) / "state.json"),
    }
)

import pytest


@pytest.fixture(autouse=True)
def _reset_caches():
    from app.api import deps
    from app.core.config import get_settings
    from app.repositories.district_repository import get_district_repository

    def clear():
        get_settings.cache_clear()
        get_district_repository.cache_clear()
        for name in dir(deps):
            fn = getattr(deps, name)
            if callable(fn) and hasattr(fn, "cache_clear"):
                fn.cache_clear()

    clear()
    yield
    clear()
