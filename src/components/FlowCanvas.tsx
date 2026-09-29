import { useState } from "react";
import { ArrowRight, Check, Circle, ChevronDown } from "lucide-react";
import { useWorkbench } from "@/state/workbench";
import { Tag } from "@/components/WorkbenchUI";
const flows: Record<string, { label: string; owner: string }[]> = {
  F1: [
    { label: "接收资料", owner: "销售" },
    { label: "登记来源", owner: "商务支持" },
    { label: "确认有效版本", owner: "资料负责人" },
    { label: "建立档案", owner: "销售" },
  ],
  F2: [
    { label: "读取要求", owner: "Agent" },
    { label: "专业拆解", owner: "解决方案 / 产品" },
    { label: "分配缺项", owner: "PM" },
    { label: "确认需求", owner: "各专业岗位" },
  ],
  F3: [
    { label: "点表统计", owner: "Agent" },
    { label: "规则演算", owner: "Agent" },
    { label: "柜内复核", owner: "解决方案" },
    { label: "写回配置", owner: "解决方案" },
  ],
  F5: [
    { label: "读取与拆解", owner: "Agent" },
    { label: "生成四类工件", owner: "Agent" },
    { label: "澄清与评审", owner: "软件 / 研发 / 方案" },
    { label: "写回事实", owner: "责任人" },
  ],
  F4: [
    { label: "提取技术条件", owner: "Agent" },
    { label: "比较候选", owner: "硬件产品" },
    { label: "展开配件", owner: "硬件 / 方案" },
    { label: "确认选型", owner: "硬件产品" },
  ],
  F6: [
    { label: "资料检查", owner: "Agent" },
    { label: "资格与认证", owner: "关务 / 认证" },
    { label: "补充证明", owner: "销售 / 产品" },
    { label: "专业确认", owner: "关务" },
  ],
  F7: [
    { label: "汇总清单", owner: "销售" },
    { label: "准备询价", owner: "Agent" },
    { label: "供应商反馈", owner: "供应链" },
    { label: "复核成本", owner: "销售 / 财务" },
  ],
  F8: [
    { label: "匹配 BOQ", owner: "Agent" },
    { label: "确认映射", owner: "销售 / 方案" },
    { label: "校验数量金额", owner: "Agent" },
    { label: "确认报价", owner: "销售" },
  ],
  F9: [
    { label: "准备明细", owner: "Agent" },
    { label: "技术复核", owner: "技术" },
    { label: "商务评审", owner: "商务 / 销售" },
    { label: "审批记录", owner: "批准人" },
  ],
  F10: [
    { label: "文件汇集", owner: "Agent" },
    { label: "目录检查", owner: "Agent" },
    { label: "提交复核", owner: "销售 / 商务" },
    { label: "归档记录", owner: "销售 / 商务" },
  ],
  F11: [
    { label: "引用批准报价", owner: "商务支持" },
    { label: "补充谈判条件", owner: "销售" },
    { label: "草案准备", owner: "商务" },
    { label: "合同评审", owner: "正式审批人" },
  ],
  F12: [
    { label: "提取条款", owner: "Agent" },
    { label: "对照风险基线", owner: "财务 / 风控" },
    { label: "专业判断", owner: "法务 / 财务" },
    { label: "记录处置", owner: "批准人" },
  ],
  F13: [
    { label: "付款与计划", owner: "项目经理" },
    { label: "确认成本税率", owner: "财务" },
    { label: "现金流测算", owner: "Agent" },
    { label: "专业复核", owner: "财务" },
  ],
  F14: [
    { label: "定位差异", owner: "Agent" },
    { label: "识别影响", owner: "Agent / 专业岗位" },
    { label: "派发行动", owner: "PM / 责任人" },
    { label: "局部复核", owner: "受影响岗位" },
  ],
};
export function FlowCanvas({
  id,
  progress,
  onSelect,
}: {
  id: string;
  progress?: number;
  onSelect?: (index: number) => void;
}) {
  const { state } = useWorkbench();
  const [selected, setSelected] = useState<number | null>(null);
  const data = state.stageStates[id];
  const generated = id === "F5" ? state.generated : data?.generated;
  const written =
    id === "F5"
      ? state.rows
          .filter((r) => r.artifact !== "server")
          .every(
            (r) =>
              r.status === "approved" &&
              state.facts.some(
                (f) => f.id === r.id && f.revision === r.revision,
              ),
          )
      : data?.written;
  const items = flows[id] || flows.F5;
  const current =
    progress ??
    (id === "F14"
      ? Object.values(state.changeStatus).every((s) => s === "done")
        ? 4
        : Object.values(state.changeStatus).some((s) => s === "reviewing")
          ? 3
          : Object.values(state.changeStatus).some((s) => s === "assigned")
            ? 2
            : 1
      : written
        ? 4
        : generated
          ? 2
          : 0);
  return (
    <div className="flow-canvas">
      <div className="flow-caption">
        <span>流程</span>
        <Tag>{state.role}</Tag>
      </div>
      <div className="flow-nodes">
        {items.map((item, i) => (
          <div className="flow-node-group" key={item.label}>
            <button
              className={`flow-node ${current > i ? "done" : current === i ? "current" : ""} ${selected === i ? "selected" : ""}`}
              onClick={() => {
                setSelected(selected === i ? null : i);
                onSelect?.(i);
              }}
            >
              <span className="flow-node-icon">
                {current > i ? (
                  <Check size={14} />
                ) : current === i ? (
                  <Circle size={12} />
                ) : (
                  i + 1
                )}
              </span>
              <span>
                <strong>{item.label}</strong>
                <small>{item.owner}</small>
              </span>
              <ChevronDown size={12} />
            </button>
            {i < items.length - 1 ? (
              <ArrowRight className="flow-connector" size={17} />
            ) : null}
          </div>
        ))}
      </div>
      {selected !== null ? (
        <div className="flow-node-detail">
          <strong>{items[selected].label}</strong>
          <span>
            {items[selected].owner} ·{" "}
            {selected < 2
              ? "资料与规则处理"
              : selected === 2
                ? "必要确认与专业复核"
                : "已审结果写回；对外批准仍按正式流程执行"}
          </span>
        </div>
      ) : null}
    </div>
  );
}
