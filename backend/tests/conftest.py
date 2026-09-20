import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from main import app


@pytest.fixture
def client():
    with TestClient(app) as c:
        yield c
