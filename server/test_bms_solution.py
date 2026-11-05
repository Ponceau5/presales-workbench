"""BMS engineering regression cases: counting, provenance, conflicts and stage tools."""
import json
import unittest
from unittest.mock import patch
from pydantic import ValidationError
from langchain_core.tools import ToolException
from bms_solution import PointRow, CapacityPolicy, normalize_points, calculate_capacity

def row(**changes):
    value = dict(floor="GF", room="A", allocation_zone="A", device_type="TH",
                 tag="", quantity=13, interface="HLI", transport="rs485",
                 devices_per_chain=6, source_index=0, source_locator="IO!12")
    value.update(changes)
    return PointRow(**value)

def policy(**changes):
    value = dict(confirmed=True, confirmation_basis="Confirmed project rule Rev1",
                 gateway_model="project gateway", gateway_effective_ports=4,
                 module_effective_channels=dict(di=14, do=14, ai=6, ao=3),
                 plc_model="project PLC", plc_module_limit=7, plc_ethernet_ports=1,
                 cpu_effective_channels=dict(di=0,do=0,ai=0,ao=0),
                 gateway_ethernet_ports=1, switch_effective_ports=20)
    value.update(changes)
    return CapacityPolicy(**value)

class BmsCountingTests(unittest.TestCase):
    def test_cpu_builtin_io_is_deducted_before_expansion_modules(self):
        points=row(interface="LLI",transport="hardwired",quantity=1,di=0,do=29,ai=0,ao=0,io_basis="row_total")
        result=calculate_capacity([points],policy(cpu_effective_channels=dict(di=14,do=10,ai=2,ao=0)))["zones"][0]
        self.assertEqual(result["modules"]["do"],2)
        self.assertEqual(result["plc_count_lower_bound"],1)
        with self.assertRaises(ValueError):calculate_capacity([points],policy(cpu_effective_channels=None))

    def test_per_device_and_total_are_not_multiplied_twice(self):
        per = row(interface="LLI", transport="hardwired", quantity=3, di=2, do=1, ai=0, ao=0, io_basis="per_device")
        total = row(interface="LLI", transport="hardwired", quantity=3, di=6, do=3, ai=0, ao=0, io_basis="row_total")
        self.assertEqual(normalize_points([per])["totals"], normalize_points([total])["totals"])
        self.assertEqual(normalize_points([per])["totals"]["known_lli_channels"]["di"], 6)

    def test_serial_chains_and_ethernet_and_io_separate(self):
        rows = [row(), row(device_type="UPS", quantity=2, transport="ethernet"),
                row(device_type="EFAN", interface="LLI", transport="hardwired",
                    quantity=2, di=3, do=1, ai=0, ao=0, io_basis="per_device")]
        result = calculate_capacity(rows, policy())["zones"][0]
        self.assertEqual(result["serial_chains"], 3)
        self.assertEqual(result["gateway_count"], 1)
        self.assertEqual(result["modules"], dict(di=1, do=1, ai=0, ao=0))
        self.assertEqual(result["plc_count_lower_bound"], 1)
        self.assertEqual(result["ethernet_ports"], 4)

    def test_identical_duplicate_keeps_both_provenances(self):
        result = normalize_points([row(tag="TH1"), row(tag="TH1", source_locator="copy!12")])
        self.assertEqual(result["duplicate_rows_removed"], 1)
        self.assertEqual(result["totals"]["known_hli_devices"], 13)
        self.assertEqual(len(result["rows"][0]["sources"]), 2)

    def test_conflicting_tag_blocks_zone_and_excludes_totals(self):
        result = calculate_capacity([row(tag="TH1"), row(tag="TH1", quantity=14)], policy())
        self.assertEqual(result["zones"][0]["status"], "blocked")
        self.assertEqual(result["normalization"]["totals"]["known_hli_devices"], 0)

    def test_same_tag_other_floor_is_not_duplicate(self):
        result = normalize_points([row(tag="TH1"), row(tag="TH1", floor="1F", allocation_zone="1F-A")])
        self.assertEqual(result["totals"]["known_hli_devices"], 26)


    def test_same_zone_on_different_floors_cannot_pool_capacity(self):
        with self.assertRaises(ValueError):
            calculate_capacity([row(quantity=12),row(quantity=12,floor="1F")],policy())
        with self.assertRaises(ValueError):
            calculate_capacity([row()],policy(plc_model="iPAC-200"))


    def test_relevant_point_sheets_after_first_two_are_selected(self):
        import sqlite3
        from document_registry import solution_excerpt
        c=sqlite3.connect(":memory:");c.row_factory=sqlite3.Row
        c.execute("CREATE TABLE document_pages(document_id TEXT,page INTEGER,text TEXT)")
        pages=[(1,"DCOM cost\nprice only"),(2,"BMS summary"),(3,"Other general notes"),
               (4,"BMS点表\nDI DO AI AO room"),(5,"BMS屏柜点表\nDI DO room"),(6,"界面矩阵\nRACI interface whitelist")]
        c.executemany("INSERT INTO document_pages VALUES ('source',?,?)",pages)
        text,numbers=solution_excerpt(c,{"id":"source"},"F3")
        self.assertEqual(numbers,[4,5])
        self.assertIn("\n",text)
        self.assertIn("来源页 4",text)
        self.assertNotIn("price only",text)
        _,numbers=solution_excerpt(c,{"id":"source"},"F2")
        self.assertIn(6,numbers)
        c.close()

    def test_default_solution_shortcuts_and_edited_tasks_preserved(self):
        import workflow_studio
        definition=workflow_studio.builtin("F3")
        self.assertEqual([t["id"] for t in definition["tasks"]],["materials-survey","deliverable","normalize","capacity"])
        self.assertTrue(all(t["taskbook_md"] for t in definition["tasks"]))
        chosen=next(t for t in definition["tasks"] if t["id"]=="capacity")
        chosen["name"]="My capacity workflow"
        self.assertEqual(next(t for t in workflow_studio.enrich_solution_tasks(definition,"F3")["tasks"] if t["id"]=="capacity")["name"],"My capacity workflow")

    def test_unknown_does_not_become_zero_or_block_other_zone(self):
        result = calculate_capacity([row(quantity=None), row(room="B", allocation_zone="B")], policy())
        self.assertEqual(result["status"], "partial")
        self.assertEqual(result["zones"][0]["status"], "blocked")
        self.assertEqual(result["zones"][1]["gateway_count"], 1)

    def test_effective_capacity_not_reserved_twice_and_not_pooled(self):
        rows = [row(quantity=24), row(room="B", allocation_zone="B", quantity=24)]
        result = calculate_capacity(rows, policy())
        self.assertEqual([v["gateway_count"] for v in result["zones"]], [1, 1])
        self.assertEqual(calculate_capacity([row(quantity=25)], policy())["zones"][0]["gateway_count"], 2)

    def test_lli_missing_channels_and_serial_missing_chain_block(self):
        for value in [row(interface="LLI", transport="hardwired", io_basis="row_total", di=4),
                      row(devices_per_chain=None)]:
            self.assertEqual(calculate_capacity([value], policy())["zones"][0]["status"], "blocked")

    def test_sw_does_not_consume_hardware_but_is_retained(self):
        value = row(interface="SW", transport="none", quantity=4000)
        result = calculate_capacity([value], policy())
        self.assertEqual(result["zones"][0]["gateway_count"], 0)
        self.assertEqual(result["zones"][0]["plc_count_lower_bound"], 0)
        self.assertEqual(result["normalization"]["rows"][0]["quantity"], 4000)

    def test_unconfirmed_rules_incomplete_policy_and_wrong_zone_rejected(self):
        with self.assertRaises(ValueError): calculate_capacity([row()], policy(confirmed=False))
        with self.assertRaises(ValueError): calculate_capacity([row()], policy(module_effective_channels={"di":14}))
        with self.assertRaises(ValueError): calculate_capacity([row()], policy(other_ethernet_ports_by_zone={"missing":2}))
        with self.assertRaises(ValidationError): row(quantity=-1)
        with self.assertRaises(ValidationError): row(quantity=1.5)
        with self.assertRaises(ValidationError): policy(gateway_effective_ports=0)

    def test_agent_tools_only_available_at_solution_stages_and_authorized(self):
        import agent_engine
        snapshots=[dict(id="io", title="IO", version="V1", purpose="input", text="13 TH devices")]
        with patch("access_control.check_project"):
            def tools(stage, sources=snapshots):
                return {t.name:t for t in agent_engine.snapshot_tools("test","project",sources,{},[],stage)}
            f2=tools("F2")
            self.assertIn("normalize_bms_points",f2)
            self.assertNotIn("calculate_bms_capacity",f2)
            self.assertNotIn("normalize_bms_points",tools("F7"))
            f3=tools("F3")
            result=json.loads(f3["calculate_bms_capacity"].invoke(dict(rows=[row().model_dump()],policy=policy().model_dump())))
            self.assertEqual(result["zones"][0]["gateway_count"],1)
            self.assertIn("unresolved",json.loads(f3["read_bms_rules"].invoke({})))
            with self.assertRaises(ToolException):
                f3["normalize_bms_points"].invoke(dict(rows=[row(source_index=5).model_dump()]))
            with self.assertRaises(ToolException):
                tools("F3",[dict(text="template example",purpose="output")])["normalize_bms_points"].invoke(dict(rows=[row().model_dump()]))
            with self.assertRaises(ToolException):
                f3["calculate_bms_capacity"].invoke(dict(rows=[row().model_dump()],policy=policy(plc_model="iPAC-200").model_dump()))
        with patch("access_control.check_project", side_effect=ToolException("forbidden")):
            with self.assertRaises(ToolException):
                f3["read_bms_rules"].invoke({})

if __name__=="__main__":unittest.main()
