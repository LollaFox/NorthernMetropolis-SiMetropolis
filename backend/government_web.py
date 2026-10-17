"""Explicit offline government test provider; never masquerades as live AI."""
from .ai import OfflineProvider, DecisionError
from .government_cli import dry_decision


class GovernmentTestProvider(OfflineProvider):
    source_type = "government_offline_test_not_ai"

    def call(self, role, context):
        if role != "government":
            raise DecisionError("Only government is allowed in this mode")
        return dry_decision(context)
