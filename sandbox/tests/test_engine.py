"""Behavioral and invariant tests for the synthetic monthly city model."""

import copy
import json
import math
import unittest

from sandbox import engine


def advance(world, months, decisions=None):
    for _ in range(months):
        world = engine.step_world(world, decisions=decisions)
    return world


def decision(actor, action, **extra):
    return {"actor": actor, "action": action, "reason": "Test current-state choice",
            "message": "Public test statement", "sourceType": "live", **extra}


class EngineTests(unittest.TestCase):
    def setUp(self):
        self.world = engine.create_world()

    def test_initial_scene_is_populated_spaced_and_clear_of_river(self):
        self.assertTrue(35 <= len(self.world["buildings"]) <= 55)
        buildings = self.world["buildings"]
        self.assertEqual(set(engine.BUILDING_KINDS), {b["kind"] for b in buildings})
        for i, building in enumerate(buildings):
            self.assertFalse(15 <= building["x"] <= 24)
            self.assertTrue(-48 <= building["x"] <= 48 and -48 <= building["z"] <= 48)
            distances = [math.hypot(building["x"] - other["x"], building["z"] - other["z"])
                         for other in buildings[i + 1:]]
            self.assertTrue(all(distance >= 8 for distance in distances))
        self.assertGreater(self.world["metrics"]["population"], 10000)
        self.assertGreater(self.world["metrics"]["jobs"], 0)

    def test_seed_and_repeated_path_are_deterministic(self):
        self.assertEqual(self.world, engine.create_world(42))
        self.assertNotEqual(self.world["buildings"], engine.create_world(43)["buildings"])
        a = advance(engine.intervene(self.world, "Build affordable housing"), 36)
        b = advance(engine.intervene(engine.create_world(), "Build affordable housing"), 36)
        self.assertEqual(a, b)

    def test_functions_do_not_mutate_inputs_and_return_independent_values(self):
        before = copy.deepcopy(self.world)
        tick = engine.step_world(self.world)
        changed = engine.intervene(self.world, "Build a park")
        validated = engine.validate_world(self.world)
        packet = engine.actor_packet(self.world, "government")
        self.assertEqual(before, self.world)
        tick["policies"]["green"] = 0
        changed["actors"][0]["cashM"] = 0
        validated["buildings"][0]["height"] = 1
        packet["policies"]["housing"] = 0
        self.assertEqual(before, self.world)

    def test_empty_decision_list_suppresses_rules_but_advances_real_time(self):
        quiet = advance(self.world, 12, decisions=[])
        automatic = advance(self.world, 12)
        self.assertEqual(12, quiet["month"])
        self.assertEqual(2027, quiet["year"])
        self.assertEqual(42, len(quiet["buildings"]))
        self.assertGreater(len(automatic["buildings"]), 42)
        for key in ("population", "treasuryM", "businessCashM", "happiness", "airQuality", "emissions", "powerDemand"):
            self.assertNotEqual(self.world["metrics"][key], quiet["metrics"][key], key)

    def test_construction_commits_cost_before_capacity_and_finishes_at_lead_time(self):
        built = engine.intervene(self.world, "build_housing")
        project = built["buildings"][-1]
        self.assertEqual(0, project["progress"])
        self.assertEqual(self.world["metrics"]["homes"], built["metrics"]["homes"])
        self.assertEqual(20, self.world["metrics"]["treasuryM"] - built["metrics"]["treasuryM"])
        for month in range(1, 7):
            built = engine.step_world(built, decisions=[])
            self.assertAlmostEqual(month / 6, built["buildings"][-1]["progress"])
            self.assertEqual(self.world["metrics"]["homes"] + (480 if month == 6 else 0), built["metrics"]["homes"])
        self.assertTrue(any(e["type"] == "completion" for e in built["events"]))

    def test_wait_preserves_current_month_emissions_during_construction(self):
        world = advance(engine.intervene(self.world, "build_housing"), 1, [])
        held = engine.intervene(world, "wait")
        self.assertEqual(world["metrics"], held["metrics"])
        self.assertEqual(world["buildings"], held["buildings"])
        self.assertEqual(world["actors"], held["actors"])
        self.assertEqual(world["month"], held["month"])

    def test_repeated_instant_actions_retain_incurred_emissions_and_defer_new_works(self):
        world = advance(engine.intervene(self.world, "build_housing"), 1, [])
        emissions = world["metrics"]["emissions"]
        for action in ("wait", "raise_tax", "support_business", "build_park", "build_solar", "build_office", "wait"):
            with self.subTest(action=action):
                world = engine.intervene(world, action)
                self.assertEqual(emissions, world["metrics"]["emissions"])
                self.assertEqual(1, world["month"])
        self.assertEqual(3, len([b for b in world["buildings"] if b["progress"] == 0]))
        self.assertAlmostEqual(20 / 6 * 40, world["metrics"]["constructionEmissions"])
        next_month = engine.step_world(world, [])
        self.assertAlmostEqual((20 / 6 + 6 / 3 + 12 / 4 + 28 / 8) * 40,
                               next_month["metrics"]["constructionEmissions"])

    def test_completion_month_and_legacy_snapshots_preserve_construction_emissions(self):
        for month in (0, 1, 6, 7):
            with self.subTest(month=month):
                world = advance(engine.intervene(self.world, "build_housing"), month, [])
                original_emissions = world["metrics"]["emissions"]
                legacy = copy.deepcopy(world)
                legacy["metrics"].pop("constructionEmissions", None)
                for action in ("wait", "build_solar", "wait", "raise_tax"):
                    legacy = engine.intervene(legacy, action)
                    self.assertEqual(original_emissions, legacy["metrics"]["emissions"])
                    self.assertAlmostEqual(20 / 6 * 40 if month in (1, 6) else 0,
                                           legacy["metrics"]["constructionEmissions"])

    def test_redeveloping_just_completed_asset_cannot_erase_its_incurred_emissions(self):
        world = advance(self.world, 240)
        target = engine.actor_packet(world, "energy")["actionCatalog"]["build_solar"]["targetId"]
        # Leave exactly one solar asset below its density cap so the second works
        # necessarily overwrite that just-completed asset's start metadata.
        for building in world["buildings"]:
            if building["kind"] == "solar" and building["id"] != target:
                building["capacity"] = building["baseCapacity"] * 4
        world = engine.intervene(world, "wait")
        world = advance(engine.intervene(world, "build_solar"), 4, [])
        project = next(b for b in world["buildings"] if b["id"] == target)
        self.assertEqual(1, project["progress"])
        incurred = world["metrics"]["constructionEmissions"]
        self.assertGreaterEqual(incurred, 120)
        for action in ("build_solar", "wait", "raise_tax", "wait"):
            world = engine.intervene(world, action)
            self.assertEqual(incurred, world["metrics"]["constructionEmissions"])
        project = next(b for b in world["buildings"] if b["id"] == target)
        self.assertEqual(0, project["progress"])
        self.assertEqual(world["month"], project["startedMonth"])

    def test_each_building_catalog_lead_time_and_physical_capacity(self):
        cases = [("build_office", "jobs", 8), ("build_industry", "jobs", 7),
                 ("build_park", "greenSpace", 3), ("build_solar", "powerCapacity", 4),
                 ("build_transit", "transitCapacity", 9)]
        for action, metric, lead in cases:
            with self.subTest(action=action):
                baseline = advance(self.world, lead - 1, [])
                scenario = advance(engine.intervene(self.world, action), lead - 1, [])
                self.assertEqual(baseline["metrics"][metric], scenario["metrics"][metric])
                baseline = engine.step_world(baseline, [])
                scenario = engine.step_world(scenario, [])
                self.assertGreater(scenario["metrics"][metric], baseline["metrics"][metric])

    def test_cooperative_housing_uses_its_own_smaller_cash_backed_project(self):
        changed = engine.step_world(self.world, [decision("residents", "build_housing")])
        project = changed["buildings"][-1]
        self.assertEqual(("residents", 280, 12), (project["owner"], project["capacity"], project["constructionCostM"]))
        self.assertEqual(self.world["metrics"]["treasuryM"] +
                         next(l["revenueM"] - l["costM"] for l in changed["ledger"] if l["actor"] == "government"),
                         changed["metrics"]["treasuryM"])

    def test_rules_make_constrained_state_dependent_role_actions(self):
        later = advance(self.world, 60)
        actions = [m for m in later["messages"] if m["source"] in engine.ACTOR_IDS]
        self.assertTrue(actions)
        for message in actions:
            self.assertEqual("rules", message["sourceType"])
            self.assertIn(message["action"], engine.ROLE_ACTIONS[message["source"]])
        for actor in later["actors"]:
            self.assertGreaterEqual(actor["cashM"], 0)
            pending = [b for b in later["buildings"] if b["owner"] == actor["id"] and b["progress"] < 1]
            self.assertLessEqual(len(pending), engine.BUILD_LIMITS[actor["id"]])

    def test_live_decision_has_attribution_and_suppresses_other_role_rules(self):
        later = engine.step_world(self.world, [decision("business", "build_office")])
        self.assertEqual(43, len(later["buildings"]))
        self.assertEqual("business", later["buildings"][-1]["owner"])
        self.assertEqual("live", later["messages"][-1]["sourceType"])
        self.assertIn("Public test statement", later["messages"][-1]["text"])
        self.assertFalse(any(m["source"] == "government" for m in later["messages"]))

    def test_unauthorized_and_malformed_decisions_reject_atomically(self):
        invalid = [
            [decision("energy", "raise_tax")], [decision("government", "build_industry")],
            [decision("residents", "support_business")], [decision("unknown", "wait")],
            [decision("business", "build_office", capacity=999999)],
            [decision("business", "build_office", reason=17)],
            [decision("business", "build_office", sourceType="fake")],
            [decision("business", "wait"), decision("business", "build_office")],
            {"actor": "government", "action": "wait"}, [None],
        ]
        before = copy.deepcopy(self.world)
        for proposals in invalid:
            with self.subTest(proposals=proposals), self.assertRaises(engine.ValidationError):
                engine.step_world(self.world, proposals)
            self.assertEqual(before, self.world)

    def test_unaffordable_live_proposal_is_rejected_without_stopping_tick(self):
        world = copy.deepcopy(self.world)
        world["actors"][3]["cashM"] = 0
        before = copy.deepcopy(world)
        later = engine.step_world(world, [decision("energy", "build_solar")])
        self.assertEqual(1, later["month"])
        self.assertEqual(42, len(later["buildings"]))
        self.assertEqual("rejected:build_solar", later["messages"][-1]["action"])
        self.assertEqual("live", later["messages"][-1]["sourceType"])
        self.assertIn("cannot afford", later["messages"][-1]["text"])
        self.assertNotEqual(before["metrics"]["population"], later["metrics"]["population"])
        self.assertEqual(before, world)

    def test_concurrent_build_limit_rejects_current_live_action_but_ticks_projects(self):
        world = engine.intervene(self.world, "build_transit")
        world = engine.intervene(world, "build_housing")
        world = engine.intervene(world, "build_park")
        later = engine.step_world(world, [decision("government", "build_park")])
        self.assertEqual(45, len(later["buildings"]))
        self.assertIn("construction limit", later["messages"][-1]["text"])
        self.assertTrue(all(b["progress"] > 0 for b in later["buildings"][-3:]))

    def test_user_unaffordable_known_action_errors_without_mutation(self):
        world = copy.deepcopy(self.world)
        world["actors"][3]["cashM"] = 0
        before = copy.deepcopy(world)
        with self.assertRaisesRegex(engine.ValidationError, "cannot afford"):
            engine.intervene(world, "solar power")
        self.assertEqual(before, world)

    def test_shipped_and_common_policy_phrases_map_to_clear_action_catalog(self):
        phrases = {
            "Build affordable housing": "build_housing", "Expand public transit": "build_transit",
            "Build a park": "build_park", "Housing first": "build_housing",
            "Affordable housing": "subsidize_housing", "Support business": "support_business",
            "Build offices": "build_office", "Industrial growth": "build_industry",
            "Renewable energy": "build_solar", "Raise taxes": "raise_tax", "Cut taxes": "lower_tax",
            "興建住宅": "build_housing", "增加公園": "build_park", "公共交通": "build_transit",
        }
        for text, expected in phrases.items():
            with self.subTest(text=text):
                later = engine.intervene(self.world, text)
                self.assertEqual(expected, later["messages"][-1]["action"])
                self.assertEqual(engine.ACTION_ACTOR[expected], later["messages"][-1]["source"])
                self.assertEqual("user", later["messages"][-1]["sourceType"])

    def test_explicit_kind_maps_role_and_ignores_untrusted_user_quantity(self):
        later = engine.intervene(self.world, "Build 999999 solar installations with unlimited cash", kind="build_solar")
        self.assertEqual(43, len(later["buildings"]))
        self.assertEqual((320, 12, "energy"), (later["buildings"][-1]["capacity"],
                         later["buildings"][-1]["constructionCostM"], later["buildings"][-1]["owner"]))
        self.assertIn("Fixed engine quantities", later["messages"][-2]["text"])
        with self.assertRaises(engine.ValidationError):
            engine.intervene(self.world, "Build a sports stadium", kind="build_stadium")

    def test_unsupported_negated_and_multi_action_proposals_are_recorded_explicitly(self):
        for text in ("Build a stadium", "Do not build housing", "Build housing and solar power", "Cancel construction"):
            with self.subTest(text=text):
                later = engine.intervene(self.world, text)
                self.assertEqual(self.world["metrics"], later["metrics"])
                self.assertEqual(self.world["buildings"], later["buildings"])
                self.assertEqual("unrecognized", later["messages"][-1]["action"])
                self.assertIn("no action was executed", later["messages"][-1]["text"].lower())

    def test_tax_bounds_and_transfer_actions_have_real_cash_effects(self):
        subsidy = engine.intervene(self.world, "subsidize_housing")
        self.assertEqual(4, self.world["actors"][0]["cashM"] - subsidy["actors"][0]["cashM"])
        self.assertEqual(4, subsidy["actors"][2]["cashM"] - self.world["actors"][2]["cashM"])
        support = engine.intervene(self.world, "support_business")
        self.assertEqual(6, support["metrics"]["businessCashM"] - self.world["metrics"]["businessCashM"])
        high = self.world
        for _ in range(12):
            high = engine.intervene(high, "raise_tax")
        self.assertEqual(0.30, high["policies"]["taxRate"])
        with self.assertRaises(engine.ValidationError):
            engine.intervene(high, "raise_tax")
        low = self.world
        for _ in range(5):
            low = engine.intervene(low, "lower_tax")
        self.assertEqual(0.05, low["policies"]["taxRate"])
        with self.assertRaises(engine.ValidationError):
            engine.intervene(low, "lower_tax")

    def test_policy_counterfactuals_diverge_through_physical_and_economic_paths(self):
        neutral = advance(self.world, 18, [])
        housing = advance(engine.intervene(self.world, "Build affordable housing"), 18, [])
        solar = advance(engine.intervene(self.world, "Renewable energy"), 18, [])
        transit = advance(engine.intervene(self.world, "Expand public transit"), 18, [])
        tax = advance(engine.intervene(self.world, "raise_tax"), 18, [])
        self.assertGreater(housing["metrics"]["homes"], neutral["metrics"]["homes"])
        self.assertGreater(housing["metrics"]["population"], neutral["metrics"]["population"])
        self.assertLess(solar["metrics"]["emissions"], neutral["metrics"]["emissions"])
        self.assertLess(transit["metrics"]["emissions"], neutral["metrics"]["emissions"])
        self.assertGreater(tax["metrics"]["treasuryM"], neutral["metrics"]["treasuryM"])
        self.assertLess(tax["actors"][2]["cashM"], neutral["actors"][2]["cashM"])

    def test_green_and_industry_strategies_have_distinct_operational_footprints(self):
        green = advance(engine.intervene(self.world, "build_solar"), 36)
        industry = advance(engine.intervene(self.world, "build_industry"), 36)
        self.assertNotEqual(green["metrics"], industry["metrics"])
        self.assertGreater(sum(b["capacity"] for b in industry["buildings"] if b["kind"] == "industry"),
                           sum(b["capacity"] for b in green["buildings"] if b["kind"] == "industry"))

    def test_underfunded_operations_reduce_jobs_and_never_create_debt(self):
        world = copy.deepcopy(self.world)
        world["metrics"].update(population=0, housingPressure=0, employmentRate=0, businessCashM=0)
        world["actors"][1]["cashM"] = 0
        later = engine.step_world(world, [])
        self.assertEqual(0, later["operations"]["business"])
        self.assertEqual(180, later["metrics"]["jobs"])
        self.assertEqual(0, later["actors"][1]["cashM"])

    def test_600_month_horizon_remains_finite_grows_and_redevelops(self):
        world = self.world
        for _ in range(600):
            world = engine.step_world(world)
            metrics = world["metrics"]
            self.assertLessEqual(metrics["population"], math.floor(metrics["homes"] * engine.PEOPLE_PER_HOME))
            self.assertTrue(all(math.isfinite(value) for value in metrics.values()))
            self.assertTrue(all(a["cashM"] >= 0 for a in world["actors"]))
        self.assertEqual((600, 2076), (world["month"], world["year"]))
        self.assertEqual(132, len(world["buildings"]))
        self.assertTrue(any(b["upgrades"] > 0 for b in world["buildings"]))
        self.assertLessEqual(len(world["messages"]), 80)
        self.assertLessEqual(len(world["events"]), 80)
        self.assertEqual(120, len(world["ledger"]))
        self.assertEqual(len(world["buildings"]), len({b["id"] for b in world["buildings"]}))
        self.assertGreater(world["metrics"]["population"], self.world["metrics"]["population"])

    def test_full_city_redevelopment_packet_reports_outage_and_added_capacity(self):
        world = advance(self.world, 240)
        self.assertEqual(132, len(world["buildings"]))
        packet = engine.actor_packet(world, "energy")
        entry = packet["actionCatalog"]["build_solar"]
        self.assertEqual("redevelopment", entry["mode"])
        self.assertTrue(entry["oldCapacityOfflineDuringWorks"])
        self.assertEqual(entry["capacity"] - entry["oldCapacity"], entry["addedCapacity"])
        changed = engine.intervene(world, "build_solar")
        project = next(b for b in changed["buildings"] if b["id"] == entry["targetId"])
        self.assertEqual(0, project["progress"])
        self.assertEqual(entry["capacity"], project["capacity"])
        self.assertEqual(world["metrics"]["powerCapacity"] - entry["oldCapacity"], changed["metrics"]["powerCapacity"])
        later = advance(changed, 4, [])
        self.assertEqual(world["metrics"]["powerCapacity"] + entry["addedCapacity"], later["metrics"]["powerCapacity"])

    def test_density_capped_city_rejects_further_capex_without_capacity_gain(self):
        world = advance(self.world, 240)
        for building in world["buildings"]:
            if building["kind"] == "solar":
                building.update(progress=1, capacity=building["baseCapacity"] * 4)
        # This fixture retains an observed lower power summary, within physical bounds.
        engine.validate_world(world)
        packet = engine.actor_packet(world, "energy")
        self.assertNotIn("build_solar", packet["allowedActions"])
        self.assertEqual("unavailable", packet["actionCatalog"]["build_solar"]["mode"])
        before = copy.deepcopy(world)
        with self.assertRaisesRegex(engine.ValidationError, "density cap"):
            engine.intervene(world, "build_solar")
        self.assertEqual(before, world)
        later = engine.step_world(world, [decision("energy", "build_solar")])
        self.assertEqual(world["month"] + 1, later["month"])
        self.assertEqual([b for b in world["buildings"] if b["kind"] == "solar"],
                         [b for b in later["buildings"] if b["kind"] == "solar"])
        self.assertEqual([b["id"] for b in world["buildings"]], [b["id"] for b in later["buildings"]])
        self.assertIn("density cap", later["messages"][-1]["text"])
        self.assertFalse(any(item["action"] == "build_solar" and item["month"] == world["month"]
                             for item in later["ledger"]))

    def test_power_shortage_caps_operational_jobs_until_solar_finishes(self):
        world = copy.deepcopy(self.world)
        for building in world["buildings"]:
            if building["kind"] == "solar":
                building["progress"] = 0
        world["metrics"]["powerCapacity"] = engine.GRID_POWER
        short = engine.step_world(world, [])
        self.assertLess(short["metrics"]["jobs"], self.world["metrics"]["jobs"])
        self.assertLess(short["metrics"]["powerCapacity"], short["metrics"]["powerDemand"])
        recovered = advance(short, 3, [])
        self.assertEqual(self.world["metrics"]["powerCapacity"], recovered["metrics"]["powerCapacity"])
        self.assertGreater(recovered["metrics"]["jobs"], short["metrics"]["jobs"])

    def test_actor_packet_excludes_rival_private_information_and_ledger(self):
        world = copy.deepcopy(self.world)
        world["actors"][1]["stance"] = "PRIVATE_BUSINESS_SENTINEL"
        world["actors"][2]["name"] = "PRIVATE_RESIDENT_SENTINEL"
        world["actors"][3]["cashM"] = 918273.456
        world["future"] = {"SECRET_FUTURE_SENTINEL": 123}
        for actor_id in engine.ACTOR_IDS:
            packet = engine.actor_packet(world, actor_id)
            serialized = json.dumps(packet)
            self.assertNotIn("SECRET_FUTURE_SENTINEL", serialized)
            self.assertNotIn("treasuryM", packet["publicState"])
            self.assertNotIn("businessCashM", packet["publicState"])
            self.assertNotIn("ledger", packet)
            self.assertEqual(actor_id, packet["actor"]["id"])
            if actor_id != "business":
                self.assertNotIn("PRIVATE_BUSINESS_SENTINEL", serialized)
            if actor_id != "residents":
                self.assertNotIn("PRIVATE_RESIDENT_SENTINEL", serialized)
            if actor_id != "energy":
                self.assertNotIn("918273.456", serialized)

    def test_actor_packet_has_only_current_affordable_role_actions(self):
        world = copy.deepcopy(self.world)
        world["actors"][3]["cashM"] = 0
        packet = engine.actor_packet(world, "energy")
        self.assertEqual(["wait"], packet["allowedActions"])
        for actor_id in engine.ACTOR_IDS:
            packet = engine.actor_packet(self.world, actor_id)
            self.assertTrue(all(isinstance(action, str) for action in packet["allowedActions"]))
            self.assertTrue(set(packet["allowedActions"]).issubset(engine.ROLE_ACTIONS[actor_id]))
            self.assertEqual(self.world["month"], packet["month"])

    def test_packets_bound_unicode_and_preserve_message_provenance(self):
        world = self.world
        for _ in range(12):
            world = engine.intervene(world, "世" * 1100)
        world = engine.step_world(world, [decision("business", "wait", message="界" * 590)])
        for actor_id in engine.ACTOR_IDS:
            packet = engine.actor_packet(world, actor_id)
            self.assertLessEqual(len(json.dumps(packet, ensure_ascii=True).encode()), 5200)
            for message in packet["messages"]:
                self.assertNotEqual(actor_id, message["source"])
                self.assertLessEqual(message["month"], packet["month"])
                self.assertIn(message["sourceType"], ("rules", "live", "user"))

    def test_invalid_world_states_are_rejected_without_repair(self):
        mutators = [lambda w: w["metrics"].update(happiness=101),
                    lambda w: w["metrics"].update(emissions=float("nan")),
                    lambda w: w["policies"].update(taxRate=0),
                    lambda w: w["actors"][0].update(cashM=-1),
                    lambda w: w["buildings"][0].update(x=20),
                    lambda w: w["buildings"][0].update(progress=1.1),
                    lambda w: w["buildings"][0].update(capacity=9999999),
                    lambda w: w.update(year=1900),
                    lambda w: w["metrics"].update(homes=1),
                    lambda w: w["metrics"].update(jobs=99999999),
                    lambda w: w["metrics"].update(powerCapacity=999999),
                    lambda w: w["metrics"].update(population=999999),
                    lambda w: w["messages"][0].update(month=1),
                    lambda w: w["actors"][1].update(id="government", role="government")]
        for mutate in mutators:
            with self.subTest(mutate=mutate):
                world = copy.deepcopy(self.world)
                mutate(world)
                with self.assertRaises(engine.ValidationError):
                    engine.validate_world(world)

    def test_duplicate_or_overlapping_buildings_and_bad_input_types_reject(self):
        for changes in ({"id": self.world["buildings"][1]["id"]},
                        {"x": self.world["buildings"][1]["x"], "z": self.world["buildings"][1]["z"]}):
            world = copy.deepcopy(self.world)
            world["buildings"][0].update(changes)
            with self.assertRaises(engine.ValidationError):
                engine.validate_world(world)
        for seed in (True, 4.2, "42", 2**40):
            with self.assertRaises(engine.ValidationError):
                engine.create_world(seed)
        for text in ("", None, "x" * 1201):
            with self.assertRaises(engine.ValidationError):
                engine.intervene(self.world, text)
        with self.assertRaises(engine.ValidationError):
            engine.actor_packet(self.world, "outsider")

    def test_model_document_exposes_assumptions_costs_equations_and_limitations(self):
        model = engine.model_document()
        self.assertIn("not a calibrated forecast", model["status"])
        self.assertTrue(model["equations"])
        self.assertTrue(model["limitations"])
        self.assertEqual((20, 6, 480), tuple(model["actions"]["build_housing"][key] for key in ("costM", "leadMonths", "capacity")))
        model["policyBounds"]["housing"] = (-100, 100)
        self.assertEqual((0, 1), engine.POLICY_BOUNDS["housing"])


if __name__ == "__main__":
    unittest.main()
