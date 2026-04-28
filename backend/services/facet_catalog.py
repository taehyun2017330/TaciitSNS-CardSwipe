import json
from functools import lru_cache
from pathlib import Path
from typing import Dict, List


ROOT_DIR = Path(__file__).resolve().parents[2]
CATALOG_PATH = ROOT_DIR / "shared" / "facet_catalog.json"


@lru_cache(maxsize=1)
def load_facet_catalog() -> List[dict]:
    return json.loads(CATALOG_PATH.read_text(encoding="utf-8"))


def feature_keys() -> List[str]:
    return [facet["key"] for facet in load_facet_catalog()]


def feature_definitions() -> str:
    lines = []
    for facet in load_facet_catalog():
        lines.append(f"- {facet['key']}: {facet['description']}")
    return "\n".join(lines)


def feature_schema() -> Dict[str, dict]:
    return {
        key: {"type": "number", "minimum": 0, "maximum": 1}
        for key in feature_keys()
    }
