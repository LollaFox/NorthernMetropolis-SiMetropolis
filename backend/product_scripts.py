"""The three construction scripts offered on the product Configure screen."""
import json
from pathlib import Path

from .scenario import validate_scenario

# Display names match the JSON "name" field and the Configure choices.
SCRIPTS = {
    "default-city": "default-city.json",
    "function-zones": "function-zones.json",
    "mixed-zones": "mixed-zones.json",
}


def load_product_script(name):
    filename = SCRIPTS.get(name)
    if not filename:
        raise ValueError("Unknown construction script")
    path = Path(__file__).resolve().parents[1] / "scripts" / filename
    return validate_scenario(json.loads(path.read_text(encoding="utf-8")))
