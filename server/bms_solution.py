"""BMS point normalization and bounded, reproducible capacity calculations.

No file paths, automatic product substitutions, prices, or project writes.
"""
from collections import defaultdict
from math import ceil
from typing import Annotated, Literal
from pydantic import BaseModel, ConfigDict, Field

RULE_VERSION = "bms-solution-0.2"

Count = Annotated[int, Field(strict=True, ge=0, le=1000000)]
Positive = Annotated[int, Field(strict=True, ge=1, le=1000000)]

class PointRow(BaseModel):
    model_config = ConfigDict(extra="forbid")
    floor: str = Field(min_length=1, max_length=80)
    room: str = Field(min_length=1, max_length=100)
    allocation_zone: str = Field(min_length=1, max_length=120)
    device_type: str = Field(min_length=1, max_length=100)
    tag: str = Field(default="", max_length=100)
    quantity: Count | None = None
    interface: Literal["HLI", "LLI", "SW", "unknown"]
    transport: Literal["rs485", "ethernet", "hardwired", "none", "unknown"]
    protocol: str = Field(default="", max_length=100)
    di: Count | None = None
    do: Count | None = None
    ai: Count | None = None
    ao: Count | None = None
    io_basis: Literal["per_device", "row_total", "unknown"] = "unknown"
    devices_per_chain: Positive | None = None
    source_index: int = Field(ge=0)
    source_locator: str = Field(min_length=1, max_length=300)

class CapacityPolicy(BaseModel):
    model_config = ConfigDict(extra="forbid")
    confirmed: bool
    confirmation_basis: str = Field(min_length=1, max_length=1000)
    gateway_model: str = Field(min_length=1, max_length=100)
    gateway_effective_ports: Positive
    module_effective_channels: dict[Literal["di", "do", "ai", "ao"], Positive]
    plc_model: str = Field(min_length=1, max_length=100)
    plc_module_limit: Positive
    cpu_effective_channels: dict[Literal["di", "do", "ai", "ao"], Count] | None = None
    plc_ethernet_ports: Count
    gateway_ethernet_ports: Count
    switch_effective_ports: Positive
    other_ethernet_ports_by_zone: dict[str, Count] = Field(default_factory=dict, max_length=200)


def normalize_points(rows: list[PointRow]) -> dict:
    if not 1 <= len(rows) <= 500:
        raise ValueError("一次请处理 1–500 行点表；大表按楼层或区域分批")
    normalized, issues, seen = [], [], {}
    duplicates = 0
    for number, row in enumerate(rows, 1):
        value = row.model_dump()
        for field in ("floor", "room", "allocation_zone", "device_type", "tag"):
            value[field] = value[field].strip()
            if field != "tag" and not value[field]:
                raise ValueError("楼层、房间、分配区域和设备类型不能为空")
        status = "ready"
        if row.tag.strip():
            key = tuple(value[k].casefold() for k in ("floor", "room", "device_type", "tag"))
            signature = {k: v for k, v in value.items() if k not in {"source_index", "source_locator"}}
            if key in seen:
                previous, original = seen[key]
                if signature == original:
                    previous["sources"].append({"source_index": row.source_index, "locator": row.source_locator})
                    duplicates += 1
                    continue
                previous["status"] = status = "conflict"
                issues.append({"row": number, "zone": value["allocation_zone"], "reason": "同位号存在不同数量、接口或点数；保留原行，确认后再计算"})
            else:
                seen[key] = (value, signature)
        reason = None
        if row.quantity is None or row.interface == "unknown":
            reason = "数量或接口未知，不能按零处理"
        elif row.interface == "HLI" and row.transport not in {"rs485", "ethernet"}:
            reason = "HLI 需要确认串口或以太网接入"
        elif row.interface == "LLI" and (row.transport != "hardwired" or row.io_basis == "unknown" or any(getattr(row, k) is None for k in ("di", "do", "ai", "ao"))):
            reason = "LLI 需明确硬接线、四类 IO 数量（无则填 0）及每台/整行口径"
        if reason:
            if status != "conflict": status = "pending"
            issues.append({"row": number, "zone": value["allocation_zone"], "reason": reason})
        value.update(status=status, sources=[{"source_index": row.source_index, "locator": row.source_locator}])
        if row.interface == "LLI" and row.quantity is not None and row.io_basis != "unknown" and all(getattr(row, k) is not None for k in ("di", "do", "ai", "ao")):
            multiplier = row.quantity if row.io_basis == "per_device" else 1
            value["io_totals"] = {k: getattr(row, k) * multiplier for k in ("di", "do", "ai", "ao")}
        normalized.append(value)
    # One conflicting tag invalidates every retained row with that tag.
    conflict_keys = {tuple(r[k].casefold() for k in ("floor", "room", "device_type", "tag")) for r in normalized if r["status"] == "conflict"}
    for value in normalized:
        if value["tag"] and tuple(value[k].casefold() for k in ("floor", "room", "device_type", "tag")) in conflict_keys:
            value["status"] = "conflict"
    ready = [r for r in normalized if r["status"] == "ready"]
    return {"rule_version": RULE_VERSION, "rows": normalized, "duplicate_rows_removed": duplicates, "issues": issues,
            "totals": {"known_hli_devices": sum(r["quantity"] for r in ready if r["interface"] == "HLI"),
                       "known_lli_channels": {k: sum(r.get("io_totals", {}).get(k, 0) for r in ready) for k in ("di", "do", "ai", "ao")},
                       "pending_rows": sum(r["status"] != "ready" for r in normalized)},
            "counting_basis": "HLI 为设备台数，不代表采集变量数、许可点数或历史存储点数；SW 不计硬件通道，但不得从 F5 服务器测点中自动剔除"}


def calculate_capacity(rows: list[PointRow], policy: CapacityPolicy) -> dict:
    if not policy.confirmed or not policy.confirmation_basis.strip():
        raise ValueError("请先确认本项目端口预留、串接、模块容量与 PLC 组合规则")
    if set(policy.module_effective_channels) != {"di", "do", "ai", "ao"}:
        raise ValueError("请提供 DI/DO/AI/AO 四类模块的有效通道数")
    if policy.cpu_effective_channels is None or set(policy.cpu_effective_channels)!={"di","do","ai","ao"}:
        raise ValueError("请确认CPU自带DI/DO/AI/AO有效通道；确实没有的通道明确填0，不能漏计")
    if "ipac" in (policy.plc_model + policy.gateway_model).casefold().replace("-", "").replace(" ", ""):
        raise ValueError("iPAC 混合扩展规则未确认，不能套普通 PLC 槽位公式")
    normalized = normalize_points(rows)

    zones_to_floors = defaultdict(set)
    for row in normalized["rows"]:
        zones_to_floors[row["allocation_zone"]].add(row["floor"])
    if any(len(floors) > 1 for floors in zones_to_floors.values()):
        raise ValueError("同名分配区域跨楼层，请明确独立区域编号；不能合并容量")
    groups = defaultdict(list)
    for row in normalized["rows"]:
        groups[row["allocation_zone"]].append(row)
    if set(policy.other_ethernet_ports_by_zone) - set(groups):
        raise ValueError("附加网口需求包含点表不存在的分配区域")
    results = []
    for zone, items in groups.items():
        missing = ["数量、接口或同位号冲突尚未确认"] if any(r["status"] != "ready" for r in items) else []
        serial = [r for r in items if r["interface"] == "HLI" and r["transport"] == "rs485" and r["quantity"]]
        if any(r["devices_per_chain"] is None for r in serial):
            missing.append("串口设备缺少已确认的每串设备上限")
        if missing:
            results.append({"zone": zone, "status": "blocked", "missing": missing})
            continue
        chains = sum(ceil(r["quantity"] / r["devices_per_chain"]) for r in serial)
        gateways = ceil(chains / policy.gateway_effective_ports)
        io = {k: sum(r.get("io_totals", {}).get(k, 0) for r in items) for k in ("di", "do", "ai", "ao")}
        def modules_for(cpus):
            return {k: ceil(max(0,io[k]-cpus*policy.cpu_effective_channels[k]) / policy.module_effective_channels[k]) for k in io}
        plcs=0
        if any(io.values()):
            low,high=1,max(1,ceil(sum(modules_for(0).values())/policy.plc_module_limit))
            while low<high:
                middle=(low+high)//2
                if sum(modules_for(middle).values())<=middle*policy.plc_module_limit:high=middle
                else:low=middle+1
            plcs=low
        modules=modules_for(plcs)
        ethernet = sum(r["quantity"] for r in items if r["interface"] == "HLI" and r["transport"] == "ethernet")
        ethernet += gateways * policy.gateway_ethernet_ports + plcs * policy.plc_ethernet_ports + policy.other_ethernet_ports_by_zone.get(zone, 0)
        switches = ceil(ethernet / policy.switch_effective_ports)
        results.append({"zone": zone, "status": "calculated", "serial_chains": chains,
                        "gateway_count": gateways, "io_channels": io, "modules": modules,
                        "plc_count_lower_bound": plcs, "ethernet_ports": ethernet,
                        "switch_count_lower_bound": switches,
                        "formulas": {"gateway": f"ceil({chains}/{policy.gateway_effective_ports})={gateways}",
                                     "modules": {k: f"ceil(max(0,{io[k]}-{plcs}*{policy.cpu_effective_channels[k]})/{policy.module_effective_channels[k]})={modules[k]}" for k in io},
                                     "plc": f"最小CPU数量n：sum(ceil(max(0,IO-n*CPU自带有效通道)/模块有效通道)) <= n*{policy.plc_module_limit}；n={plcs}",
                                     "switch": f"ceil({ethernet}/{policy.switch_effective_ports})={switches}"},
                        "sources": [s for r in items for s in r["sources"]]})
    return {"rule_version": RULE_VERSION, "status": "partial" if any(r["status"] == "blocked" for r in results) else "calculated",
            "rule_basis": policy.model_dump(), "zones": results, "normalization": normalized,
            "review_required": ["按已确认分配区域独立计算，不跨区域抵扣余量", "PLC 数量为模块槽位下限；还需校核具体 CPU、模块顺序、电源及通信兼容性", "交换机数量为端口容量下限；上联、环网、双网、冗余和距离需另行核对", "柜数、线长、传感器布点、服务器规格与采购 BOM 未由本工具计算；不可据此宣称完整设计通过"]}
