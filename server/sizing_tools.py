"""可重复的测点范围、存储计算工具。公式来自当前服务器规格模型。"""
from __future__ import annotations
from pydantic import BaseModel, Field, model_validator

class SizingInputs(BaseModel):
    scope: str = Field(pattern="^(schedule|phases|custom)$")
    point_low: int = Field(default=71000, ge=1, le=100000000)
    point_high: int = Field(default=83000, ge=1, le=100000000)
    device_count: int = Field(default=2390, ge=0, le=10000000)
    sampling_seconds: float = Field(default=60, ge=1, le=86400)
    retention_years: float = Field(default=3, gt=0, le=10)
    record_types: int = Field(default=1, ge=1, le=20)
    cache_days: float = Field(default=1095, ge=0, le=3650)
    events_per_device_day: float = Field(default=0, ge=0, le=100000)
    waveform_devices: int = Field(default=0, ge=0, le=10000000)
    waveforms_per_device_day: float = Field(default=0, ge=0, le=100000)
    backup_copies: int = Field(default=1, ge=0, le=5)
    raid_usable_ratio: float = Field(default=2/3, gt=0, le=1)
    headroom: float = Field(default=0.2, ge=0, le=1)
    phase_ids: list[str] = Field(default_factory=lambda: ["p1", "p2", "p3"])
    sampling_confirmed: bool = False
    scope_confirmed: bool = False
    assumptions_confirmed: bool = False
    scope_note: str = Field(default="", max_length=1000)

    @model_validator(mode="after")
    def valid_range(self):
        if self.point_high < self.point_low:
            raise ValueError("测点上限不能小于下限")
        if self.scope == "phases" and (not self.phase_ids or len(set(self.phase_ids)) != len(self.phase_ids)
                                       or not set(self.phase_ids) <= {"p1","p2","p3"}):
            raise ValueError("分期范围必须非空且不可重复")
        return self

def estimate_point_range(inputs: SizingInputs, materials: dict) -> dict:
    """同口径内合计；点表与分期经验估算不能混加。"""
    if inputs.scope == "schedule":
        low = high = materials["schedule"]["total"]
        source = "软件点表 EPMS (2)、BMS (2)：数量 × 单台 software 点位"
    elif inputs.scope == "phases":
        selected = [p for p in materials["phases"] if p["id"] in inputs.phase_ids]
        low = sum(p["low"] for p in selected)
        high = sum(p["high"] for p in selected)
        source = "总体估算分期表：选中阶段相加，包含新增机房及配套；经验估算，非点表实测"
    else:
        low, high = inputs.point_low, inputs.point_high
        source = "人工录入范围：" + inputs.scope_note
    return {"low": low, "high": high, "mid": (low+high)/2, "source": source,
            "scope": inputs.scope, "warning": "楼栋全量不等于 DCOM 实际上送子集；应确认接入边界。"}

def calculate_storage(points: int, inputs: SizingInputs) -> dict:
    """十进制 GB。各段分别计算，主备每台承载全量，不除以二。"""
    samples_second = points / inputs.sampling_seconds
    time_series_gb = points * 365 * 86400 / inputs.sampling_seconds * inputs.retention_years * inputs.record_types * 3 / 1e9
    events_gb = inputs.device_count * inputs.events_per_device_day * 365 * inputs.retention_years * 0.5 / 1e6
    waves_gb = inputs.waveform_devices * inputs.waveforms_per_device_day * 365 * inputs.retention_years * 38.2 / 4.61 / 1e6
    pg_gb = (events_gb + waves_gb) * 2 + points / 100000 * 0.35 + 100
    cache_gb = samples_second * inputs.cache_days * 0.54 / 1000
    # 备份这里按库的完整副本估算，单列，不能把主备当备份。
    backup_gb = (time_series_gb + pg_gb) * inputs.backup_copies
    usable_gb = time_series_gb + pg_gb + cache_gb + backup_gb
    raw_data_gb = usable_gb * (1 + inputs.headroom) / inputs.raid_usable_ratio
    return {k: round(v, 3) for k,v in {
        "points": points, "samples_per_second": samples_second, "time_series_gb": time_series_gb,
        "pg_gb": pg_gb, "cache_gb": cache_gb, "backup_gb": backup_gb,
        "required_usable_gb": usable_gb, "raw_data_gb": raw_data_gb}.items()}

def calculate_server_sizing(inputs: SizingInputs, materials: dict) -> dict:
    points = estimate_point_range(inputs, materials)
    if not all([inputs.sampling_confirmed, inputs.scope_confirmed, inputs.assumptions_confirmed, inputs.scope_note.strip()]):
        raise ValueError("请确认采样周期、接入范围和存储假设，并填写接入范围说明")
    return {"points": points, "low": calculate_storage(points["low"], inputs),
            "high": calculate_storage(points["high"], inputs), "inputs": inputs.model_dump(),
            "formula_version": "服务器规格设计模型_v1.0/存储容量口径",
            "limitations": [
                "CPU/内存与拆分方案由 Skill 指导生成建议，尚未实现完整的性能回验工具；需方案人员审核。",
                "基础存储含应用固定 100 GB；系统盘、额外镜像/日志、备份介质隔离未计入采购总量。",
                "事件/波形默认 0 表示暂未计入，不表示实际没有；修改前应确认业务量。",
                "缓存默认按三年线性累计，不默认滚动清空；保留天数可调整。",
                "时序 3 Byte、波形压缩比 4.61 是模型经验系数，非项目性能保证。"]}
