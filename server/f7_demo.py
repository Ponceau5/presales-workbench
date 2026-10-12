"""Clearly fictional CRM and deterministic F7 cost/quote scenario for local demos.

The rates below are sample inputs, not project data or approved tax/price rules.
Template formula references were checked against overseas-cost-template.xlsx V6.
"""
import json
import re

DEMO_PROJECT = "DEMO-CRM-001"


def money(value):
    return f"{value:,.2f}"


def _previous_overrides(context):
    try:
        turns = json.loads(context).get("turns", [])
        for turn in reversed(turns):
            overrides = turn.get("demoScenario", {}).get("overrides", {})
            if isinstance(overrides, dict):
                return overrides
    except (TypeError, ValueError, AttributeError):
        pass
    return {}


def scenario(question="", context=""):
    """Return a single calculation source for chat, preview, and Excel inputs."""
    overrides = _previous_overrides(context)
    change = re.search(r"服务器(?:采购)?单价\s*(?:改为|调整为|设为|=|：|:)\s*([\d,.]+)\s*(万|元)?", question)
    if change:
        value = float(change.group(1).replace(",", "")) * (10000 if change.group(2) == "万" else 1)
        if 1 <= value <= 1000000:
            overrides = {**overrides, "serverCostUnit": round(value, 2)}
    server_cost_unit = float(overrides.get("serverCostUnit", 75000))
    crm = [
        {"sku": "DEMO-PMC-01", "name": "PMC 控制器", "qty": 8, "listUnit": 42000, "costUnit": 24360, "quoteUnit": 39900, "kind": "自产产品", "basis": "演示 CRM 面价 × 95%；成本按面价 × 58%"},
        {"sku": "DEMO-CAB-01", "name": "组屏控制柜", "qty": 4, "listUnit": 58000, "costUnit": 37700, "quoteUnit": 55100, "kind": "自产产品", "basis": "演示 CRM 面价 × 95%；成本按面价 × 65%"},
        {"sku": "DEMO-SRV-01", "name": "服务器", "qty": 2, "listUnit": 112000, "costUnit": server_cost_unit, "quoteUnit": 112000, "kind": "外购设备", "basis": "演示 CRM 报价；采购成本为演示假设"},
        {"sku": "DEMO-GW-01", "name": "交换机与网关", "qty": 6, "listUnit": 18500, "costUnit": 12000, "quoteUnit": 18500, "kind": "外购设备", "basis": "演示 CRM 报价；采购成本为演示假设"},
        {"sku": "DEMO-FLOW-01", "name": "流量计", "qty": 4, "listUnit": 14000, "costUnit": 8000, "quoteUnit": 14000, "kind": "外购设备", "basis": "演示 CRM 报价；采购成本为演示假设"},
        {"sku": "DEMO-SW-01", "name": "软件许可", "qty": 1, "listUnit": 280000, "costUnit": 117600, "quoteUnit": 266000, "kind": "软件", "basis": "演示 CRM 面价 × 95%；成本按面价 × 42%"},
    ]
    quote_rows = [
        *[{"sku": row["sku"], "name": row["name"], "kind": row["kind"], "qty": row["qty"], "costUnit": row["costUnit"], "quoteUnit": row["quoteUnit"], "basis": row["basis"]} for row in crm],
        {"sku": "DEMO-CON-M", "name": "施工材料", "kind": "施工与服务", "qty": 1, "costUnit": 45000, "quoteUnit": 60750, "basis": "演示成本 × 1.35"},
        {"sku": "DEMO-CON-S", "name": "施工服务", "kind": "施工与服务", "qty": 1, "costUnit": 80000, "quoteUnit": 108000, "basis": "演示成本 × 1.35"},
        {"sku": "DEMO-LABOR", "name": "现场调试", "kind": "施工与服务", "qty": 1, "costUnit": 87500, "quoteUnit": 130000, "basis": "2.5 人月 × 35,000 成本；报价 130,000 为演示假设"},
        {"sku": "DEMO-AFTER", "name": "售后支持", "kind": "施工与服务", "qty": 1, "costUnit": 18000, "quoteUnit": 25200, "basis": "演示成本 × 1.40"},
    ]
    hardware_quote = sum(row["qty"] * row["quoteUnit"] for row in quote_rows if row["sku"] in {"DEMO-PMC-01", "DEMO-CAB-01", "DEMO-SRV-01", "DEMO-GW-01", "DEMO-FLOW-01", "DEMO-CON-M"})
    service_quote = sum(row["qty"] * row["quoteUnit"] for row in quote_rows) - hardware_quote
    total_quote = hardware_quote + service_quote
    # The sample selects DAP, so the template's import tax and duty branches are zero.
    # These service tax/WHT amounts reproduce V6's Malaysia/Singapore example parameters;
    # they are not verified current tax treatment.
    service_tax = round((130000 + 25200) * 0.08 + 108000 * 0.06, 2)
    service_wht = round((130000 + 25200) * 0.05, 2)
    tax = service_tax + service_wht
    financing = round(400000 * 4 / 12 * 0.05, 2)
    costs = {
        "1:F14": 194880, "1:F16": 45000, "1:F17": 80000, "1:F18": 150800,
        "1:F20": 2 * server_cost_unit, "1:F21": 72000, "1:F22": 0, "1:F23": 32000,
        "1:F24": 0, "1:F25": 0, "1:F26": 0, "1:F27": 117600,
        "1:F29": 24000, "1:F30": 8000, "1:F31": 8000, "1:F32": 4000,
        "1:F33": 20000, "1:F35": 8000, "1:F36": 12000, "1:F37": 0,
        "1:F38": 9000, "1:F39": 28000, "1:F40": 3000, "1:F41": 6000,
        "1:F42": 5000, "1:F43": 7500, "1:F44": 5000, "1:F47": financing,
        "1:F48": 0, "1:F49": 0,
    }
    materials = costs["1:F14"] + costs["1:F16"] + costs["1:F17"] + costs["1:F18"] + sum(costs[f"1:F{row}"] for row in range(20, 27))
    labor = 87500 + sum(costs[f"1:F{row}"] for row in range(29, 34)) + 18000
    operations = sum(costs[f"1:F{row}"] for row in range(35, 45))
    total_cost = round(materials + costs["1:F27"] + labor + operations + tax + financing, 2)
    gross_margin = round(1 - total_cost / total_quote, 6)
    # Keep the quote detail's cost column reconcilable with the complete V6 cost total.
    # These indirect costs are included in the contract price, not billed as extra lines.
    quote_rows += [
        {"sku": "DEMO-DELIVERY", "name": "交付差旅与设计", "kind": "间接费用", "qty": 1, "costUnit": 64000, "quoteUnit": 0, "basis": "对应主表 F29–F33；合同总价内吸收"},
        {"sku": "DEMO-OPS", "name": "其他运营费用", "kind": "间接费用", "qty": 1, "costUnit": operations, "quoteUnit": 0, "basis": "对应主表 F35–F44；合同总价内吸收"},
        {"sku": "DEMO-TAX", "name": "演示税费", "kind": "间接费用", "qty": 1, "costUnit": tax, "quoteUnit": 0, "basis": "对应主表 F45–F46；仅沿用 V6 示例参数"},
        {"sku": "DEMO-FIN", "name": "演示资金成本", "kind": "间接费用", "qty": 1, "costUnit": financing, "quoteUnit": 0, "basis": "对应主表 F47；合同总价内吸收"},
    ]
    template_inputs = {
        "1:A1": f"【模拟演示】{DEMO_PROJECT} 项目-成本估算",
        "1:B2": "演示签约主体（虚构）", "1:B3": "演示客户（虚构）", "1:B4": "马来西亚 · 演示地点",
        "1:B5": "演示业主（虚构）", "1:B6": "30%预付款、40%进度款、20%验收款、10%尾款（演示假设）",
        "1:B7": total_quote, "1:B8": hardware_quote, "1:B9": service_quote,
        "1:B10": "30%预付款、40%进度款、20%验收款、10%尾款；见现金流页（演示假设）",
        "1:B12": f"CNY {money(total_cost)}（演示测算）",
        "2:C6": 1, "2:E6": 1.5, "2:F6": 1.5,
        "2:C9": 1, "2:E9": 1, "2:F9": 1,
        "2:R6": 10, "2:T6": 1800,
        "3:B4": 0.3, "3:F4": 0.4, "3:B5": 0.2, "3:B6": 0.1,
        "3:B13": round(total_quote * 0.3, 2), "3:B15": round(total_quote * 0.4, 2),
        "3:B17": round(total_quote * 0.2, 2), "3:B19": round(total_quote * 0.1, 2),
        "4:B5": "马来西亚", "4:B6": "新加坡公司", "4:B7": "DAP", "4:B8": 4,
        "4:B12": hardware_quote, "4:B13": 266000, "4:B14": 155200, "4:B15": 108000, "4:B16": 0,
        "7:C4": "正常清关", "7:C5": "DAP", "7:C6": "海运", "7:C7": "马来西亚",
        "7:C8": 28000, "7:C9": 9000, "7:C10": 0, "7:C16": "是", "7:C17": "客户", "7:C18": "演示客户（虚构）",
        **costs,
    }
    calculated = {
        "1:F7": "CNY", "1:F8": gross_margin, "1:F15": 125000, "1:F19": 2 * server_cost_unit + 72000 + 32000,
        "1:F28": 87500, "1:F34": 18000, "1:F45": tax, "1:F46": 0, "1:F50": total_cost,
        "2:F14": 2.5, "2:U14": 18000,
        "4:B20": 0, "4:B21": 0, "4:B22": 0, "4:B23": service_tax,
        "4:B24": service_wht, "4:B25": 0, "4:B28": tax, "4:B30": 0, "4:B31": tax,
        "7:C13": 37000,
    }
    assumptions = [
        "自产 PMC、组屏、软件成本分别按演示 CRM 面价的 58%、65%、42%；对应报价按面价的 95%。",
        "外购服务器、交换机与流量计的采购成本为演示采购回价；施工材料和服务报价按成本 × 1.35。",
        "调试 2.5 人月，按 V6 模板 35,000 元/人月；差旅、住宿、签证、物流等逐项采用演示数量与单价。",
        "税费使用 V6 模板中马来西亚/新加坡主体/DAP 的示例参数计算：进口税与关税为 0，服务税与预提税合计按模板公式得出。参数未核验现行法规。",
        "资金成本按平均垫资 400,000 元 × 4/12 年 × 5%；报价及付款节点均为演示假设。",
    ]
    return {
        "project": DEMO_PROJECT, "currency": "CNY", "country": "马来西亚", "incoterm": "DAP",
        "crm": crm, "quoteRows": quote_rows, "assumptions": assumptions,
        "templateInputs": template_inputs, "calculatedCells": calculated,
        "totals": {"materials": materials, "software": costs["1:F27"], "labor": labor,
                   "operations": operations, "tax": tax, "financing": financing,
                   "cost": total_cost, "hardwareQuote": hardware_quote,
                   "serviceQuote": service_quote, "quote": total_quote,
                   "grossMargin": gross_margin},
        "overrides": overrides,
        "recognizedChange": bool(change),
    }


def reply(question, sources, data):
    quote = any(word in question for word in ("报价", "销售价", "标价"))
    revised = "补充人工确认信息：" in question or "审核意见修改" in question
    title = "报价表" if quote else "成本表"
    totals = data["totals"]
    result = [
        f"## {title}（{'修订演示' if revised else '初稿演示'}）",
        "**模拟演示｜全表为虚构数据，未调用 AI：CRM、采购回价、合同条件和税费参数均不代表当前项目事实，也不能对外报价。**",
        f"模拟项目：{data['project']}｜币种：CNY｜贸易术语：DAP｜地点：马来西亚。",
        "### 模拟 CRM 价格记录",
        "\n".join([
            "| 演示料号 | 名称 | 数量 | CRM 面价/单价 CNY | 演示采购/成本单价 CNY |",
            "| --- | --- | ---: | ---: | ---: |",
            *[f"| {row['sku']} | {row['name']} | {row['qty']} | {money(row['listUnit'])} | {money(row['costUnit'])} |" for row in data["crm"]],
        ]),
    ]
    if quote:
        result += [
            "### 逐项报价草稿",
            "\n".join([
                "| 项目 | 数量 | 单位成本 CNY | 报价单价 CNY | 报价合价 CNY | 定价依据 |",
                "| --- | ---: | ---: | ---: | ---: | --- |",
                *[f"| {row['name']} | {row['qty']} | {money(row['costUnit'])} | {money(row['quoteUnit'])} | {money(row['qty'] * row['quoteUnit'])} | {row['basis']} |" for row in data["quoteRows"]],
            ]),
            f"**总报价：CNY {money(totals['quote'])}**（设备 CNY {money(totals['hardwareQuote'])}；软件与服务 CNY {money(totals['serviceQuote'])}）",
            f"演示总成本 CNY {money(totals['cost'])}；演示毛利率 {totals['grossMargin'] * 100:.2f}%。",
        ]
    else:
        result += [
            "### V6 模板成本汇总",
            "\n".join([
                "| 成本组 | 金额 CNY | 模板口径 |",
                "| --- | ---: | --- |",
                f"| 材料成本 | {money(totals['materials'])} | F14 + F15 + F18 + F19；子项不重复计入 |",
                f"| 软件成本 | {money(totals['software'])} | F27：演示面价 × 42% |",
                f"| 人工及差旅 | {money(totals['labor'])} | F28–F34；调试 2.5 人月 × 35,000 |",
                f"| 其他运营 | {money(totals['operations'])} | F35–F44；各项演示数量 × 单价 |",
                f"| 税费成本 | {money(totals['tax'])} | 税费测算页 B28 回填 F45/F46 |",
                f"| 资金成本 | {money(totals['financing'])} | 400,000 × 4/12 × 5% |",
            ]),
            f"**总成本：CNY {money(totals['cost'])}**（对应 V6 主表 F50）。",
        ]
    result += ["### 演示假设", "\n".join(f"- {item}" for item in data["assumptions"])]
    if sources:
        source_names = "、".join(f"{item['title']}（{item['version']}，第 {item['page']} 页）" for item in sources)
        result += [f"已选择项目资料：{source_names}。本轮模拟没有读取这些资料内容，数值仍只来自虚构样例。"]
    if revised:
        result += ["### 人工输入记录", f"> {' '.join(question.split())[:300]}"]
        if data["recognizedChange"]:
            result += [f"已将演示服务器采购单价更新为 CNY {money(data['overrides']['serverCostUnit'])}，重新计算外购成本、总成本和毛利率。"]
        else:
            result += ["已记录人工意见；无 Key 演示仅自动识别“服务器采购单价改为 68000 元”这类修改，其余数值仍按上方演示假设。"]
    result += ["### 待人工处理", "请确认模拟数据与计算步骤的展示效果；正式项目仍需接入真实 CRM、采购回价、合同条件和财务审批。通过仅保存为内部演示成果。"]
    return "\n\n".join(result)
