"""Numerical invariants, context fidelity and provider-boundary regressions."""

import copy
import json
import unittest

from backend.engine import advance_month, assert_invariants, building_totals, create_world, neighborhood
from backend.scenario import (FIRM_DEFAULTS, PROFILES, apply_construction_pace, default_scenario,
                              northern_metropolis_scenario, validate_scenario)


def building(identifier, kind, x, y, month=1, start=None):
    result = {"id": identifier, "type": kind, "x": x, "y": y,
              "completionMonth": month}
    if start is not None:
        result["startMonth"] = start
    return result


def config(buildings, **values):
    result = {"grid": {"width": 8, "height": 8}, "buildings": buildings}
    result.update(values)
    return result


def action(tower, kind="move_in"):
    return {"towerId": tower, "action": kind, "reason": "A deliberate test decision."}


class RecordingProvider:
    def __init__(self, decisions=None, characters=None, firm_type="small"):
        self.decisions = decisions or {}
        self.characters = characters or {}
        self.firm_type = firm_type
        self.calls = []

    def call(self, role, context):
        self.calls.append((role, copy.deepcopy(context)))
        key = (context["step"], role)
        if key in self.decisions:
            response = self.decisions[key]
            if isinstance(response, Exception):
                raise response
            if callable(response):
                return response(context)
            return copy.deepcopy(response)
        if role == "narrator":
            return {"character": self.characters.get(context["target"]["id"],
                                                      "Synthetic character of " + context["target"]["id"])}
        if role == "firm":
            return {"firmType": self.firm_type, "reason": "A deliberate firm choice."}
        return {"actions": [], "reason": "Preserve occupancy."}

    def contexts(self, role, step=None):
        return [context for called_role, context in self.calls
                if role == called_role and (step is None or context["step"] == step)]


def decision(*actions):
    return {"actions": list(actions), "reason": "A deliberate district choice."}


class ScenarioTests(unittest.TestCase):
    def test_default_script_counts_unique_cells_and_bounds(self):
        scenario = validate_scenario(default_scenario())
        self.assertEqual(50, sum(b["type"] == "residential" for b in scenario["buildings"]))
        self.assertEqual(12, sum(b["type"] == "business" for b in scenario["buildings"]))
        self.assertEqual(10, sum(b["type"] == "park" for b in scenario["buildings"]))
        self.assertEqual(4, sum(b["type"] == "station" for b in scenario["buildings"]))
        self.assertEqual(76, len({(b["x"], b["y"]) for b in scenario["buildings"]}))
        self.assertLessEqual(max(b["completionMonth"] for b in scenario["buildings"]), 12)

    def test_normalization_and_world_do_not_alias_inputs(self):
        original = config([building("R", "residential", 1, 1)])
        world = create_world(original)
        original["buildings"][0]["x"] = 6
        self.assertEqual(1, world["buildings"][0]["x"])
        world["buildings"][0]["x"] = 2
        self.assertEqual(1, world["config"]["buildings"][0]["x"])

    def test_invalid_scripts_rejected_before_run(self):
        invalid = [
            config([building("A", "park", 1, 1), building("B", "station", 1, 1)]),
            config([building("A", "park", 1, 1), building("A", "park", 2, 2)]),
            config([building("A", "park", -1, 1)]),
            config([building("A", "park", 1, 8)]),
            config([building("A", "unknown", 1, 1)]),
            config([building("A", "park", 1, 1, 1, 2)]),
            config([building("A", "park", True, 1)]),
            config([], towerGroupSlots=5), config([], groupSize=0),
            config([], groupWorkers=26), config([], baseRent=float("nan")),
            config([], baseRent=1e308), config([], baseRent=10 ** 1000),
            config([], name="\ud800"), config([building("\ud800", "park", 1, 1)]),
            config([], firms={"large": {"wage": 15000}}),
            config([], misspelled=True),
        ]
        for script in invalid:
            with self.subTest(script=script), self.assertRaises(ValueError):
                create_world(script)


class ConstructionPacingTests(unittest.TestCase):
    def test_pacing_is_optional_and_does_not_mutate_explicit_default(self):
        original = default_scenario()
        before = copy.deepcopy(original)
        paced = apply_construction_pace(original, residential_starts_per_month=5)
        self.assertEqual(before, original)
        self.assertEqual(before, default_scenario())
        self.assertEqual(validate_scenario(paced), paced)
        self.assertEqual(paced, apply_construction_pace(paced, residential_starts_per_month=5))
        self.assertNotEqual(validate_scenario(original), paced)

    def test_five_starts_each_month_two_month_duration_completes_in_month_eleven(self):
        paced = apply_construction_pace(default_scenario(), 5, 2, 1)
        residences = [b for b in paced["buildings"] if b["type"] == "residential"]
        self.assertEqual(50, len(residences))
        starts = {month: sum(b["startMonth"] == month for b in residences)
                  for month in range(1, 12)}
        self.assertEqual({month: 5 if month <= 10 else 0 for month in range(1, 12)}, starts)
        self.assertTrue(all(b["completionMonth"] - b["startMonth"] == 1 for b in residences))
        self.assertEqual(11, max(b["completionMonth"] for b in residences))
        self.assertEqual(["R01", "R02", "R03", "R04", "R05"],
                         sorted(b["id"] for b in residences if b["startMonth"] == 1))

    def test_construction_first_month_has_no_completed_homes_or_residents(self):
        paced = apply_construction_pace(default_scenario(), 5, 2, 1)
        decisions = {(step, "budget"): lambda context: decision(*[
            action(tower["towerId"]) for tower in context["towers"]
            if "move_in" in tower["eligibleActions"]]) for step in range(1, 13)}
        provider = RecordingProvider(decisions)
        world = advance_month(create_world(paced), provider, "2025-01-01")
        homes = [b for b in world["buildings"] if b["type"] == "residential"]
        self.assertEqual(5, sum(b["status"] == "construction" for b in homes))
        self.assertEqual(45, sum(b["status"] == "planned" for b in homes))
        self.assertEqual(0, world["metrics"]["residentialTowers"])
        self.assertEqual(0, world["metrics"]["population"])
        self.assertEqual([], provider.contexts("budget", 1)[0]["towers"])
        self.assertFalse(any(ctx["target"]["type"] == "residential"
                             for ctx in provider.contexts("narrator", 1)))
        for month in range(2, 13):
            world = advance_month(world, provider, "2025-%02d-01" % month)
            self.assertEqual(min(50, (month - 1) * 5), world["metrics"]["residentialTowers"])
        self.assertEqual(50, world["metrics"]["residentialTowers"])
        self.assertEqual(1250, world["metrics"]["population"])

    def test_intervals_and_batch_order_are_stable(self):
        original = config([building("C", "residential", 1, 1),
                           building("A", "residential", 2, 1, 3),
                           building("B", "residential", 3, 1, 2)])
        paced = apply_construction_pace(original, 2, 3, 4)
        by_id = {b["id"]: b for b in paced["buildings"]}
        self.assertEqual((1, 3), (by_id["A"]["startMonth"], by_id["A"]["completionMonth"]))
        self.assertEqual((1, 3), (by_id["B"]["startMonth"], by_id["B"]["completionMonth"]))
        self.assertEqual((5, 7), (by_id["C"]["startMonth"], by_id["C"]["completionMonth"]))
        original["buildings"].reverse()
        self.assertEqual(paced, apply_construction_pace(original, 2, 3, 4))

    def test_nonresidential_and_parks_first_schedules_and_all_locations_preserved(self):
        original = default_scenario()
        for item in original["buildings"]:
            if item["type"] == "park":
                item["startMonth"] = item["completionMonth"] = 1
        before = validate_scenario(original)
        paced = apply_construction_pace(before, 5, 2, 1)
        old = {b["id"]: b for b in before["buildings"]}
        self.assertEqual(76, len(paced["buildings"]))
        for item in paced["buildings"]:
            with self.subTest(building=item["id"]):
                self.assertTrue(all(item[key] == old[item["id"]][key]
                                    for key in ("id", "type", "x", "y")))
                if item["type"] != "residential":
                    self.assertEqual(old[item["id"]], item)
        for key, value in before.items():
            if key != "buildings":
                self.assertEqual(value, paced[key])

    def test_invalid_pace_or_overflowing_script_rejected(self):
        for values in ((0, 2, 1), (1, 0, 1), (1, 2, 0), (True, 2, 1),
                       (4, False, 1), (4, 2, 1.5), (-1, 2, 1), (1, 1200, 1),
                       (1, 2, 1200)):
            with self.subTest(values=values), self.assertRaises(ValueError):
                apply_construction_pace(default_scenario(), *values)
        self.assertEqual([], apply_construction_pace(config([]))["buildings"])


class RegionalPresetTests(unittest.TestCase):
    def test_every_regional_cell_has_exactly_one_distributed_planning_object(self):
        scenario = northern_metropolis_scenario()
        self.assertEqual((12, 11), (scenario["grid"]["width"], scenario["grid"]["height"]))
        self.assertEqual(132, len(scenario["buildings"]))
        self.assertEqual({(x, y) for x in range(12) for y in range(11)},
                         {(b["x"], b["y"]) for b in scenario["buildings"]})
        for kind, expected in (("residential", 100), ("business", 20), ("park", 8), ("station", 4)):
            objects = [b for b in scenario["buildings"] if b["type"] == kind]
            self.assertEqual(expected, len(objects))
            self.assertEqual({(False, False), (False, True), (True, False), (True, True)},
                             {(b["x"] >= 6, b["y"] >= 5) for b in objects})
        self.assertAlmostEqual(300_000_000,
                               scenario["grid"]["cellSizeMeters"] ** 2 * 132, delta=.00001)
        self.assertEqual(scenario, validate_scenario(scenario))

    def test_reference_scale_is_capacity_with_independent_firm_choices(self):
        scenario = northern_metropolis_scenario()
        self.assertEqual((6250, 3750, 4), tuple(scenario[key] for key in
                                              ("groupSize", "groupWorkers", "towerGroupSlots")))
        self.assertEqual(2_500_000, 100 * scenario["groupSize"] * scenario["towerGroupSlots"])
        self.assertEqual(520_000, scenario["firms"]["small"]["jobCapacity"] * 20)
        self.assertEqual(780_000, scenario["firms"]["large"]["jobCapacity"] * 20)
        self.assertEqual(650_000, sum(p["jobCapacity"] * 10 for p in scenario["firms"].values()))
        self.assertEqual(650_000, scenario["scale"]["nominalJobsPerBusiness"] * 20)
        for firm_type, preset in scenario["firms"].items():
            original = FIRM_DEFAULTS[firm_type]
            ratio = preset["jobCapacity"] / original["jobCapacity"]
            for key in ("startingFunds", "monthlyProfit", "monthlyGDP"):
                self.assertEqual(original[key] * ratio, preset[key])
            self.assertEqual(original["wage"], preset["wage"])
        self.assertEqual(4000, scenario["baseRent"])
        self.assertEqual(1000, scenario["rentPremium"])
        self.assertEqual("development_cluster", scenario["scale"]["unit"])

    def test_regional_construction_pace_and_nonresidential_spread(self):
        scenario = northern_metropolis_scenario()
        homes = [b for b in scenario["buildings"] if b["type"] == "residential"]
        self.assertEqual(21, max(b["completionMonth"] for b in homes))
        for month in range(1, 21):
            self.assertEqual(5, sum(b["startMonth"] == month for b in homes))
            self.assertEqual(5, sum(b["completionMonth"] == month + 1 for b in homes))
        self.assertEqual(list(range(1, 21)), sorted(b["completionMonth"] for b in
                                                    scenario["buildings"] if b["type"] == "business"))
        for kind in ("park", "station"):
            months = [b["completionMonth"] for b in scenario["buildings"] if b["type"] == kind]
            self.assertEqual(1, min(months))
            self.assertEqual(21, max(months))

    def test_optional_scale_is_strict_persisted_and_absent_from_old_default(self):
        self.assertNotIn("scale", validate_scenario(default_scenario()))
        normalized = northern_metropolis_scenario()
        world = create_world(normalized)
        self.assertEqual(normalized["scale"], world["config"]["scale"])
        normalized["scale"]["notes"].append("Changed input.")
        self.assertNotEqual(normalized["scale"], world["config"]["scale"])
        mutations = [lambda s: s.update(extra="unknown"), lambda s: s.pop("unit"),
                     lambda s: s.update(unit="literal_city"), lambda s: s.update(referenceJobs=True),
                     lambda s: s.update(referenceAreaKm2=float("nan")),
                     lambda s: s.update(notes=[]), lambda s: s.update(label="\ud800"),
                     lambda s: s["sources"][0].update(url="https://"),
                     lambda s: s["sources"][0].update(url="file:///private/reference"),
                     lambda s: s["sources"][0].update(supports=["referenceJobs", "referenceJobs"])]
        for mutate in mutations:
            scenario = northern_metropolis_scenario()
            mutate(scenario["scale"])
            with self.subTest(mutation=mutate), self.assertRaises(ValueError):
                validate_scenario(scenario)

    def test_derived_totals_distinguish_planned_completed_and_actual_without_caching(self):
        world = create_world(northern_metropolis_scenario())
        home = next(b for b in world["buildings"] if b["type"] == "residential")
        self.assertEqual({"housingCapacity": 0, "plannedHousingCapacity": 25000,
                          "actualResidents": 0, "offeredJobs": 0, "filledJobs": 0, "vacancies": 0},
                         building_totals(world, home))
        forged_copy = dict(home, status="complete")
        self.assertEqual(0, building_totals(world, forged_copy)["housingCapacity"])
        self.assertEqual(0, building_totals(world, "B001")["offeredJobs"])
        value = building_totals(world, home)
        value["actualResidents"] = 999
        self.assertEqual(0, building_totals(world, home)["actualResidents"])
        self.assertNotIn("buildingTotals", world)
        with self.assertRaises(ValueError):
            building_totals(world, "MISSING")

    def test_21_month_full_capacity_run_totals_reconcile_and_contexts_use_cluster_units(self):
        class FullCapacityProvider:
            def __init__(self):
                self.roles = []
                self.local_context = None
                self.resident_context = None

            def call(self, role, context):
                self.roles.append(role)
                if role == "narrator":
                    self.local_context = context
                    return {"character": "Synthetic aggregate cluster character."}
                if role == "firm":
                    firm_type = "small" if int(context["target"]["id"][1:]) % 2 else "large"
                    return {"firmType": firm_type, "reason": "Independent fixture choice."}
                self.resident_context = context
                return decision(*[action(tower["towerId"]) for tower in context["towers"]
                                  if "move_in" in tower["eligibleActions"]])

        provider = FullCapacityProvider()
        world = create_world(northern_metropolis_scenario())
        for offset in range(21):
            year, month = 2025 + offset // 12, 1 + offset % 12
            world = advance_month(world, provider, "%04d-%02d-01" % (year, month))
            totals = [building_totals(world, b) for b in world["buildings"]]
            self.assertEqual(world["metrics"]["population"], sum(t["actualResidents"] for t in totals))
            self.assertEqual(world["metrics"]["jobCapacity"], sum(t["offeredJobs"] for t in totals))
            self.assertEqual(world["metrics"]["filledJobs"], sum(t["filledJobs"] for t in totals))
            self.assertEqual(world["metrics"]["vacancies"], sum(t["vacancies"] for t in totals))
            self.assertEqual(world["metrics"]["residentialTowers"] * 25000,
                             sum(t["housingCapacity"] for t in totals))
            self.assertEqual(2_500_000, sum(t["plannedHousingCapacity"] for t in totals))
            if offset == 0:
                self.assertEqual((0, 0), (world["metrics"]["residentialTowers"], world["metrics"]["population"]))
        self.assertEqual((100, 20, 8, 4), tuple(world["metrics"][key] for key in
                                              ("residentialTowers", "businessTowers", "parks", "stations")))
        self.assertEqual(2_500_000, world["metrics"]["population"])
        self.assertEqual(400, world["metrics"]["groups"])
        self.assertEqual(650_000, world["metrics"]["jobCapacity"])
        self.assertEqual(650_000, world["metrics"]["filledJobs"])
        self.assertEqual(850_000, world["metrics"]["unemployedWorkers"])
        self.assertEqual(232, len(provider.roles))
        self.assertEqual("development_cluster", provider.local_context["target"]["objectUnit"])
        self.assertEqual("development_cluster", provider.resident_context["scale"]["unit"])
        self.assertEqual("aggregate synthetic HKD/firm/month",
                         provider.local_context["canonicalFacts"]["units"]["monthlyGDP"])


class SpatialAndNarrativeTests(unittest.TestCase):
    def test_exact_nine_cells_include_empty_offmap_and_diagonal(self):
        world = create_world(config([
            building("R", "residential", 0, 0), building("P", "park", 1, 1),
            building("S", "station", 3, 0),
        ]))
        world = advance_month(world, RecordingProvider(), "2025-01-01")
        cells = neighborhood(world, "R")
        self.assertEqual(9, len(cells))
        self.assertEqual([(-1, -1), (0, -1), (1, -1), (-1, 0), (0, 0),
                          (1, 0), (-1, 1), (0, 1), (1, 1)],
                         [(c["dx"], c["dy"]) for c in cells])
        self.assertEqual(5, sum(c["status"] == "off_map" for c in cells))
        self.assertEqual(2, sum(c["status"] == "empty" for c in cells))
        self.assertEqual("P", cells[-1]["building"]["id"])
        self.assertNotIn("S", [c["building"]["id"] for c in cells if c["building"]])

    def test_future_cells_empty_and_active_construction_explicit(self):
        world = create_world(config([
            building("R", "residential", 1, 1),
            building("ACTIVE", "business", 2, 1, 3, 1),
            building("FUTURE", "park", 1, 2, 3, 2),
        ]))
        world = advance_month(world, RecordingProvider(), "2025-01-01")
        cells = {(c["dx"], c["dy"]): c for c in neighborhood(world, "R")}
        self.assertEqual("construction", cells[(1, 0)]["status"])
        self.assertIsNone(cells[(1, 0)]["building"]["narrative"])
        self.assertIsNone(cells[(1, 0)]["building"]["firmId"])
        self.assertEqual("empty", cells[(0, 1)]["status"])
        self.assertIsNone(cells[(0, 1)]["building"])

    def test_same_step_shells_and_narratives_have_stable_order(self):
        script = config([
            building("S", "station", 3, 1), building("B", "business", 2, 1),
            building("A", "business", 1, 1), building("P", "park", 1, 2),
        ])
        provider = RecordingProvider()
        world = advance_month(create_world(script), provider, "2025-01-01")
        calls = [(role, ctx.get("target", {}).get("id")) for role, ctx in provider.calls]
        self.assertEqual([("firm", "A"), ("narrator", "A"), ("firm", "B"),
                          ("narrator", "B"), ("narrator", "P")], calls[:5])
        first, second = provider.contexts("firm")
        b = next(c["building"] for c in first["neighborhood"] if c["building"] and c["building"]["id"] == "B")
        self.assertEqual("complete", b["status"])
        self.assertFalse(b["occupied"])
        self.assertIsNone(b["narrative"])
        a = next(c["building"] for c in second["neighborhood"] if c["building"] and c["building"]["id"] == "A")
        self.assertTrue(a["occupied"])
        self.assertEqual("small", a["firm"]["type"])
        self.assertEqual("Synthetic character of A", a["narrative"])
        self.assertNotIn("S", world["narratives"])
        reversed_script = copy.deepcopy(script)
        reversed_script["buildings"].reverse()
        self.assertEqual(world, advance_month(create_world(reversed_script), RecordingProvider(), "2025-01-01"))

    def test_narratives_can_change_resident_decisions_without_threshold_override(self):
        def choose(context):
            return decision(action("R")) if "welcoming" in context["towers"][0]["narrative"] else decision()
        script = config([building("R", "residential", 1, 1)])
        warm = RecordingProvider({(1, "budget"): choose}, {"R": "Synthetic welcoming character."})
        cold = RecordingProvider({(1, "budget"): choose}, {"R": "Synthetic reserved character."})
        warm_world = advance_month(create_world(script), warm, "2025-01-01")
        cold_world = advance_month(create_world(script), cold, "2025-01-01")
        self.assertEqual(25, warm_world["metrics"]["population"])
        self.assertEqual(0, cold_world["metrics"]["population"])
        self.assertEqual(0, warm_world["groups"][0]["conditions"]["employedWorkers"])
        self.assertIsNone(warm_world["groups"][0]["conditions"]["meanCommute"])

    def test_history_recent_construction_and_current_population_supplied(self):
        provider = RecordingProvider({(1, "budget"): decision(action("R"))})
        world = create_world(config([
            building("R", "residential", 1, 1),
            building("B", "business", 2, 1, 3, 2),
        ]))
        world = advance_month(world, provider, "2025-01-01")
        world = advance_month(world, provider, "2025-02-01")
        context = provider.contexts("stability", 2)[0]
        self.assertEqual(["B"], [b["id"] for b in context["construction"]["started"]])
        self.assertEqual("construction", context["construction"]["active"][0]["status"])
        self.assertEqual(1, len(context["history"]))
        target = context["towers"][0]["target"]
        self.assertEqual(25, target["population"])
        self.assertEqual(["budget"], target["occupancy"]["profiles"])
        self.assertGreaterEqual(context["towers"][0]["conditions"]["constructionChanges"], 2)
        world = advance_month(world, provider, "2025-03-01")
        firm = provider.contexts("firm", 3)[0]
        resident = next(c["building"] for c in firm["neighborhood"]
                        if c["building"] and c["building"]["type"] == "residential")
        self.assertEqual(25, resident["population"])


class SettlementTests(unittest.TestCase):
    def test_optional_batch_receives_same_prestate_and_records_in_profile_order(self):
        class BatchedProvider(RecordingProvider):
            def call_batch(self, requests):
                self.requests = copy.deepcopy(requests)
                requests[0][1]["towers"][0]["target"]["x"] = 999
                return [decision(action("R")), RuntimeError("private-token"),
                        decision(action("R")), decision()]

        provider = BatchedProvider()
        world = advance_month(create_world(config([building("R", "residential", 1, 1)])),
                              provider, "2025-01-01")
        self.assertEqual(list(PROFILES), [role for role, _ in provider.requests])
        for _, context in provider.requests:
            self.assertEqual(0, context["towers"][0]["occupancy"]["population"])
        self.assertEqual(["budget", "park"], [g["profile"] for g in world["groups"]])
        audits = [entry for entry in world["audit"] if entry["role"] in PROFILES]
        self.assertEqual(list(PROFILES), [entry["role"] for entry in audits])
        self.assertEqual(["ok", "provider_error", "ok", "ok"], [entry["status"] for entry in audits])
        self.assertEqual(1, audits[0]["context"]["towers"][0]["target"]["x"])
        self.assertNotIn("private-token", json.dumps(world))
        self.assertEqual(["narrator"], [role for role, _ in provider.calls])

    def test_batch_protocol_failure_rejects_profiles_without_duplicate_calls(self):
        class InvalidBatchProvider(RecordingProvider):
            def call_batch(self, requests):
                return [decision(action("R"))]

        provider = InvalidBatchProvider()
        world = advance_month(create_world(config([building("R", "residential", 1, 1)])),
                              provider, "2025-01-01")
        self.assertEqual(0, world["metrics"]["population"])
        self.assertEqual(4, sum(e["kind"] == "resident_decision_rejected" for e in world["events"]))
        self.assertEqual(["narrator"], [role for role, _ in provider.calls])
        for role in PROFILES:
            self.assertIn("one result per requested profile", world["roleHistory"][role][-1]["error"])

    def test_batch_exception_preserves_existing_groups_and_other_monthly_work(self):
        class FailingBatchProvider(RecordingProvider):
            def call_batch(self, requests):
                if requests[0][1]["step"] == 1:
                    return [decision(action("R")), decision(), decision(), decision()]
                raise TimeoutError("private-provider-message")

        provider = FailingBatchProvider()
        world = create_world(config([building("R", "residential", 1, 1),
                                     building("B", "business", 2, 1)]))
        world = advance_month(world, provider, "2025-01-01")
        group_id = world["groups"][0]["id"]
        world = advance_month(world, provider, "2025-02-01")
        self.assertEqual(group_id, world["groups"][0]["id"])
        self.assertEqual(1_100_000, world["firms"][0]["funds"])
        self.assertTrue(all(world["roleHistory"][role][-1]["status"] == "provider_error"
                            for role in PROFILES))
        self.assertNotIn("private-provider-message", json.dumps(world))

    def test_four_shared_profiles_fixed_groups_and_no_automatic_departure(self):
        provider = RecordingProvider({(1, role): decision(action("R")) for role in PROFILES})
        world = advance_month(create_world(config([building("R", "residential", 1, 1)])),
                              provider, "2025-01-01")
        self.assertEqual(100, world["metrics"]["population"])
        self.assertEqual(4, len(world["groups"]))
        self.assertEqual({25}, {g["size"] for g in world["groups"]})
        self.assertEqual({15}, {g["workers"] for g in world["groups"]})
        self.assertEqual(set(PROFILES), {g["profile"] for g in world["groups"]})
        for role in PROFILES:
            self.assertEqual(0, provider.contexts(role)[0]["towers"][0]["occupancy"]["population"])
        # All unemployed with low synthetic satisfaction, but no code threshold
        # forces departures when AI chooses no action.
        later = advance_month(world, provider, "2025-02-01")
        self.assertEqual([g["id"] for g in world["groups"]], [g["id"] for g in later["groups"]])

    def test_competing_arrivals_rotate_priority_and_reject_capacity_explicitly(self):
        decisions = {(step, role): decision(action("R%d" % step))
                     for step in range(1, 5) for role in PROFILES}
        provider = RecordingProvider(decisions)
        world = create_world(config([building("R%d" % month, "residential", month, 1, month)
                                     for month in range(1, 5)], towerGroupSlots=1))
        for month in range(1, 5):
            world = advance_month(world, provider, "2025-%02d-01" % month)
            self.assertEqual(PROFILES[month - 1], world["groups"][-1]["profile"])
            self.assertEqual(3, sum(e["kind"] == "arrival_capacity_rejected" for e in world["events"]))
        self.assertEqual(100, world["metrics"]["population"])

    def test_invalid_whole_role_preserves_all_its_existing_occupancy(self):
        script = config([building("R1", "residential", 1, 1), building("R2", "residential", 2, 1)])
        provider = RecordingProvider({
            (1, "budget"): decision(action("R1")),
            (2, "budget"): decision(action("R1", "leave"), action("MISSING")),
            (2, "park"): decision(action("R2")),
        })
        world = advance_month(create_world(script), provider, "2025-01-01")
        group_id = world["groups"][0]["id"]
        world = advance_month(world, provider, "2025-02-01")
        self.assertEqual(group_id, next(g["id"] for g in world["groups"] if g["profile"] == "budget"))
        self.assertEqual(50, world["metrics"]["population"])
        record = world["roleHistory"]["budget"][-1]
        self.assertEqual("invalid_response", record["status"])
        self.assertEqual([], record["outcomes"])

    def test_duplicate_and_conflicting_actions_reject_whole_role(self):
        for actions in ([action("R"), action("R")], [action("R"), action("R", "leave")]):
            with self.subTest(actions=actions):
                provider = RecordingProvider({(1, "budget"): decision(*actions)})
                world = advance_month(create_world(config([building("R", "residential", 1, 1)])),
                                      provider, "2025-01-01")
                self.assertEqual(0, world["metrics"]["population"])
                self.assertEqual("invalid_response", world["roleHistory"]["budget"][-1]["status"])

    def test_own_group_only_and_existing_profile_cannot_arrive_twice(self):
        provider = RecordingProvider({
            (1, "budget"): decision(action("R")),
            (2, "work"): decision(action("R", "leave")),
            (2, "budget"): decision(action("R")),
        })
        world = create_world(config([building("R", "residential", 1, 1)]))
        world = advance_month(world, provider, "2025-01-01")
        world = advance_month(world, provider, "2025-02-01")
        self.assertEqual(25, world["metrics"]["population"])
        self.assertEqual(2, sum(e["kind"] == "resident_decision_rejected" for e in world["events"]))

    def test_leave_and_later_arrival_are_distinct_outside_groups(self):
        provider = RecordingProvider({(1, "budget"): decision(action("A")),
                                      (2, "budget"): decision(action("A", "leave"), action("B"))})
        world = create_world(config([building("A", "residential", 1, 1), building("B", "residential", 2, 1)]))
        world = advance_month(world, provider, "2025-01-01")
        old = world["groups"][0]["id"]
        world = advance_month(world, provider, "2025-02-01")
        self.assertEqual(1, len(world["groups"]))
        self.assertEqual("B", world["groups"][0]["towerId"])
        self.assertNotEqual(old, world["groups"][0]["id"])
        self.assertEqual(["residents_left", "residents_arrived"],
                         [e["kind"] for e in world["events"] if e["kind"].startswith("residents_")])

    def test_action_order_within_role_is_stable_tower_id_order(self):
        script = config([building("Z", "residential", 1, 1), building("A", "residential", 2, 1)])
        first = RecordingProvider({(1, "budget"): decision(action("Z"), action("A"))})
        second = RecordingProvider({(1, "budget"): decision(action("A"), action("Z"))})
        left = advance_month(create_world(script), first, "2025-01-01")
        right = advance_month(create_world(script), second, "2025-01-01")
        self.assertEqual(left["groups"], right["groups"])
        self.assertEqual(["A", "Z"], [g["towerId"] for g in left["groups"]])


class EmploymentRentAndEconomicsTests(unittest.TestCase):
    def test_filled_positions_unemployment_and_release_reallocation(self):
        decisions = {(1, role): decision(action("R")) for role in PROFILES}
        decisions[(2, "budget")] = decision(action("R", "leave"))
        provider = RecordingProvider(decisions)
        world = create_world(config([building("R", "residential", 1, 1), building("B", "business", 2, 1)]))
        world = advance_month(world, provider, "2025-01-01")
        self.assertEqual((50, 50, 0, 10), tuple(world["metrics"][key] for key in
                                             ("jobCapacity", "filledJobs", "vacancies", "unemployedWorkers")))
        stable_assignments = copy.deepcopy(next(g for g in world["groups"] if g["profile"] == "work")["jobAssignments"])
        stability = next(g for g in world["groups"] if g["profile"] == "stability")
        self.assertEqual(5, stability["conditions"]["employedWorkers"])
        self.assertEqual(5000, stability["conditions"]["averageWage"])
        world = advance_month(world, provider, "2025-02-01")
        self.assertEqual((45, 5, 0), tuple(world["metrics"][key] for key in
                                          ("filledJobs", "vacancies", "unemployedWorkers")))
        self.assertEqual(stable_assignments, next(g for g in world["groups"] if g["profile"] == "work")["jobAssignments"])
        departure = next(e for e in world["events"] if e["kind"] == "residents_left")
        self.assertEqual(15, departure["releasedJobs"])

    def test_jobs_nearest_then_firm_id_and_existing_assignments_stay(self):
        provider = RecordingProvider({(1, "budget"): decision(action("R"))})
        world = create_world(config([
            building("R", "residential", 3, 3), building("B", "business", 4, 3),
            building("A", "business", 2, 3), building("C", "business", 3, 4, 2),
        ]))
        world = advance_month(world, provider, "2025-01-01")
        self.assertEqual("F:A", world["groups"][0]["jobAssignments"][0]["firmId"])
        world = advance_month(world, provider, "2025-02-01")
        self.assertEqual("F:A", world["groups"][0]["jobAssignments"][0]["firmId"])
        self.assertEqual(15, world["groups"][0]["conditions"]["employedWorkers"])

    def test_rent_qualifies_following_month_is_recomputed_and_affects_existing_group(self):
        provider = RecordingProvider({(1, "budget"): decision(action("R"))})
        world = create_world(config([
            building("R", "residential", 1, 1), building("B", "business", 2, 1),
            building("C", "business", 1, 2, 2),
        ]))
        rents = []
        for month in range(1, 5):
            world = advance_month(world, provider, "2025-%02d-01" % month)
            rents.append(world["groups"][0]["conditions"]["rentPerPerson"])
        self.assertEqual([4000, 4500, 5000, 5000], rents)
        self.assertEqual(4500, provider.contexts("budget", 2)[0]["towers"][0]["conditions"]["rentPerPerson"])

    def test_citywide_station_reduces_commute_without_changing_job(self):
        provider = RecordingProvider({(1, "budget"): decision(action("R"))})
        world = create_world(config([
            building("R", "residential", 1, 1), building("B", "business", 5, 1),
            building("S", "station", 7, 7, 2),
        ]))
        world = advance_month(world, provider, "2025-01-01")
        self.assertEqual(4, world["groups"][0]["conditions"]["meanCommute"])
        assignments = copy.deepcopy(world["groups"][0]["jobAssignments"])
        world = advance_month(world, provider, "2025-02-01")
        self.assertEqual(round(4 / 1.15, 4), world["groups"][0]["conditions"]["meanCommute"])
        self.assertEqual(assignments, world["groups"][0]["jobAssignments"])
        self.assertEqual(1, world["groups"][0]["conditions"]["stationCount"])

    def test_only_completed_adjacent_parks_improve_quality(self):
        provider = RecordingProvider({(1, "park"): decision(action("R"))})
        world = create_world(config([
            building("R", "residential", 1, 1), building("NEAR", "park", 2, 2, 2, 1),
            building("FAR", "park", 7, 7),
        ]))
        world = advance_month(world, provider, "2025-01-01")
        self.assertEqual(40, world["groups"][0]["conditions"]["housingQuality"])
        world = advance_month(world, provider, "2025-02-01")
        self.assertEqual(60, world["groups"][0]["conditions"]["housingQuality"])
        self.assertEqual(1, world["groups"][0]["conditions"]["nearbyParks"])

    def test_static_firm_profit_and_gdp_are_distinct_even_without_workers(self):
        provider = RecordingProvider(firm_type="large")
        world = create_world(config([building("B", "business", 1, 1)]))
        for month in range(1, 4):
            world = advance_month(world, provider, "2025-%02d-01" % month)
        firm = world["firms"][0]
        self.assertEqual(0, firm["filledJobs"])
        self.assertEqual(200, firm["vacancies"])
        self.assertEqual(5_600_000, firm["funds"])
        self.assertEqual(200_000, world["metrics"]["monthlyProfit"])
        self.assertEqual(400_000, world["metrics"]["monthlyGDP"])
        self.assertEqual(1_200_000, world["metrics"]["totalGDP"])
        self.assertEqual(1, len(provider.contexts("firm")))

    def test_population_weighted_satisfaction_and_empty_null(self):
        initial = create_world(config([building("R", "residential", 1, 1)]))
        self.assertIsNone(initial["metrics"]["meanSatisfaction"])
        provider = RecordingProvider({(1, role): decision(action("R")) for role in PROFILES})
        world = advance_month(initial, provider, "2025-01-01")
        scores = [g["conditions"]["satisfaction"] for g in world["groups"]]
        self.assertEqual(round(sum(scores) / 4, 4), world["metrics"]["meanSatisfaction"])
        self.assertGreater(len(set(scores)), 1)


class FailureAndRecoveryTests(unittest.TestCase):
    def test_mandatory_firm_recovers_explicitly_and_narrator_recovers(self):
        provider = RecordingProvider({(1, "firm"): {"firmType": "huge", "reason": "Bad"},
                                      (1, "narrator"): RuntimeError("private-api-key")})
        world = advance_month(create_world(config([building("B", "business", 1, 1)])),
                              provider, "2025-01-01")
        self.assertEqual(1, len(world["firms"]))
        self.assertEqual("small", world["firms"][0]["type"])
        self.assertTrue(world["buildings"][0]["narrative"])
        self.assertIn("firm_recovery", [event["kind"] for event in world["events"]])
        self.assertIn("narrative_recovery", [event["kind"] for event in world["events"]])
        self.assertNotIn("private-api-key", json.dumps(world))

    def test_injected_provider_unicode_and_quantity_fields_rejected(self):
        invalid_responses = [
            {"actions": [], "reason": "\ud800"},
            {"actions": [{"towerId": "R", "action": "move_in", "reason": "Test", "quantity": 999}], "reason": "Bad"},
            {"actions": [action("R")], "reason": "x" * 321},
            {"actions": [action("R")]}, None,
        ]
        for response in invalid_responses:
            with self.subTest(response=repr(response)):
                provider = RecordingProvider({(1, "budget"): response,
                                              (1, "narrator"): {"character": "\ud800"}})
                world = advance_month(create_world(config([building("R", "residential", 1, 1)])),
                                      provider, "2025-01-01")
                self.assertEqual(0, world["metrics"]["population"])
                self.assertEqual("invalid_response", world["roleHistory"]["budget"][-1]["status"])
                json.dumps(world, ensure_ascii=False, allow_nan=False).encode("utf-8")

    def test_provider_failure_keeps_existing_group_and_job(self):
        provider = RecordingProvider({(1, "budget"): decision(action("R")),
                                      (2, "budget"): RuntimeError("secret")})
        world = create_world(config([building("R", "residential", 1, 1), building("B", "business", 2, 1)]))
        world = advance_month(world, provider, "2025-01-01")
        group_id = world["groups"][0]["id"]
        assignments = copy.deepcopy(world["groups"][0]["jobAssignments"])
        world = advance_month(world, provider, "2025-02-01")
        self.assertEqual(group_id, world["groups"][0]["id"])
        self.assertEqual(assignments, world["groups"][0]["jobAssignments"])
        self.assertEqual("provider_error", world["roleHistory"]["budget"][-1]["status"])

    def test_immutable_input_and_provider_cannot_mutate_canonical_context(self):
        def mutate(context):
            context["towers"][0]["target"]["x"] = 999
            context["groupSize"] = 999
            return decision(action("R"))
        provider = RecordingProvider({(1, "budget"): mutate})
        original = create_world(config([building("R", "residential", 1, 1)]))
        before = copy.deepcopy(original)
        world = advance_month(original, provider, "2025-01-01")
        self.assertEqual(before, original)
        self.assertEqual(1, world["buildings"][0]["x"])
        self.assertEqual(25, world["groups"][0]["size"])
        self.assertEqual(1, next(a for a in world["audit"] if a["role"] == "budget")["context"]["towers"][0]["target"]["x"])

    def test_duplicate_month_is_idempotent_and_independent(self):
        provider = RecordingProvider({(1, "budget"): decision(action("R"))})
        world = advance_month(create_world(config([building("R", "residential", 1, 1),
                                                  building("B", "business", 2, 1)])), provider, "2025-01-01")
        count = len(provider.calls)
        repeated = advance_month(world, provider, "2025-01-01")
        self.assertEqual(world, repeated)
        self.assertEqual(count, len(provider.calls))
        repeated["groups"][0]["size"] = 999
        self.assertEqual(25, world["groups"][0]["size"])

    def test_calendar_anchor_clamping_and_invalid_skips(self):
        provider = RecordingProvider()
        world = advance_month(create_world(config([])), provider, "2024-01-31")
        world = advance_month(world, provider, "2024-02-29")
        with self.assertRaises(ValueError):
            advance_month(world, provider, "2024-03-29")
        world = advance_month(world, provider, "2024-03-31")
        for invalid in ("2024-05-31", "2024-02-29", "2024-4-30", "not-a-date", None):
            with self.subTest(invalid=invalid), self.assertRaises(ValueError):
                advance_month(world, provider, invalid)
        world = advance_month(world, provider, "2024-04-30")
        self.assertEqual(4, world["step"])

    def test_invariants_reject_corrupt_persisted_numerical_state(self):
        provider = RecordingProvider({(1, "budget"): decision(action("R"))})
        world = advance_month(create_world(config([building("R", "residential", 1, 1),
                                                  building("B", "business", 2, 1)])), provider, "2025-01-01")
        mutations = [
            lambda w: w["groups"][0].update(size=26),
            lambda w: w["groups"].append(copy.deepcopy(w["groups"][0])),
            lambda w: w["firms"][0].update(funds=1),
            lambda w: w["firms"][0].update(wage=1),
            lambda w: w["firms"][0].update(filledJobs=99),
            lambda w: w["groups"][0]["jobAssignments"][0].update(workers=16),
            lambda w: w["groups"][0]["conditions"].update(rentPerPerson=999),
            lambda w: w["groups"][0]["conditions"].update(averageWage=1),
            lambda w: w["metrics"].update(population=999),
            lambda w: w["metrics"].update(meanSatisfaction=100),
            lambda w: w["metrics"].update(parks=999),
            lambda w: w["constructionHistory"][0].update(month="2025-01-02"),
            lambda w: w.update(nextGroupId=1),
        ]
        for mutate in mutations:
            corrupt = copy.deepcopy(world)
            mutate(corrupt)
            with self.subTest(mutation=mutate), self.assertRaises(ValueError):
                assert_invariants(corrupt)

    def test_empty_scenario_still_calls_exactly_four_roles_and_remains_json(self):
        provider = RecordingProvider()
        world = advance_month(create_world(config([])), provider, "2025-01-01")
        self.assertEqual(list(PROFILES), [role for role, _ in provider.calls])
        self.assertEqual(0, world["metrics"]["population"])
        self.assertIsNone(world["metrics"]["meanSatisfaction"])
        json.dumps(world, allow_nan=False)


if __name__ == "__main__":
    unittest.main()
