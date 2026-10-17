"""Positive, counted unittest evidence for Wibe; never calls live providers."""
from pathlib import Path
import json
import sys
import unittest

root = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(root))
suite = unittest.defaultTestLoader.discover(str(Path(__file__).resolve().parent), pattern="test_*.py")
result = unittest.TextTestRunner(stream=sys.stderr, verbosity=1).run(suite)
# unittest counts test methods in testsRun but can emit multiple failing subtests
# for one method. Keep the normalized report in the same unit on both sides.
failed = len({getattr(test, "test_case", test).id() for test, _ in result.failures + result.errors})
skipped = len(result.skipped)
print(json.dumps({"schemaVersion": 1, "collected": result.testsRun,
                  "passed": result.testsRun - failed - skipped, "failed": failed,
                  "skipped": skipped, "cancelled": 0}))
raise SystemExit(0 if result.wasSuccessful() and result.testsRun > 0 else 1)
