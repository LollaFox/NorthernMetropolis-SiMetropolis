"""Paired construction experiments for the web initialization workflow."""
from .scenario import default_scenario, validate_scenario


def layout_scenario(name):
    if name not in ("segregated", "mixed"):
        raise ValueError("Unknown construction layout")
    config = default_scenario()
    config["name"] = {"segregated": "功能分区 / Segregated districts",
                      "mixed": "混合布局 / Two mixed districts"}[name]
    # Identical IDs, quantities and dates. Only the second batch locations differ.
    positions = ([(3, 3), (12, 3), (13, 3), (4, 3), (12, 4), (13, 4)]
                 if name == "segregated" else
                 [(3, 3), (12, 3), (13, 3), (12, 4), (4, 3), (3, 4)])
    config["buildings"] = [
        {"id": ident, "type": kind, "x": xy[0], "y": xy[1],
         "startMonth": start, "completionMonth": end}
        for (ident, kind, start, end), xy in zip([
            ("B01", "business", 1, 9), ("R01", "residential", 1, 7),
            ("P01", "park", 1, 4), ("B02", "business", 9, 17),
            ("R02", "residential", 9, 15), ("P02", "park", 9, 12),
        ], positions)]
    return validate_scenario(config)
