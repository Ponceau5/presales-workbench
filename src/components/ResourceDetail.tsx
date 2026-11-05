import { useState } from "react";
import { Download, Pencil, Trash2 } from "lucide-react";
import { MarkdownReply } from "@/features/software/MarkdownReply";
import "./resource-detail.css";

export type ResourceVersion = {
  id: string;
  version: string;
  downloadPath: string;
  filename: string;
};

export type ResourceDetailModel = {
  id: string;
  title: string;
  type: string;
  updatedAt: string;
  source: string;
  summary: string;
  version: string;
  versions: ResourceVersion[];
};

function ResourceDetailContent({ model, onDownload, onUpdate, onDelete, busy = false, onRetrySummary }: {
  model: ResourceDetailModel;
  onDownload: (version: ResourceVersion) => void | Promise<void>;
  onUpdate?: () => void;
  onDelete?: () => void;
  busy?: boolean;
  onRetrySummary?: () => void | Promise<void>;
}) {
  const [versionId, setVersionId] = useState(model.id);
  const selected = model.versions.find((item) => item.id === versionId) || model.versions[0];

  return (
    <section className="resource-detail" aria-label={`${model.title}资料详情`}>
      <h2>{model.title}</h2>
      <dl className="resource-detail-fields">
        <div><dt>类型</dt><dd>{model.type}</dd></div>
        <div><dt>更新时间</dt><dd>{model.updatedAt || "—"}</dd></div>
        <div><dt>来源</dt><dd>{model.source || "—"}</dd></div>
        <div><dt>版本</dt><dd>{model.version}</dd></div>
        <div className="resource-detail-summary"><dt>Agent 概要</dt><dd><MarkdownReply text={model.summary || "暂无 Agent 概要，可重试生成。"} />{onRetrySummary && <button className="btn secondary" disabled={busy} onClick={() => void onRetrySummary()}>重新生成概要</button>}</dd></div>
      </dl>
      <div className="resource-detail-actions">
        {model.versions.length > 1 && <select aria-label="下载版本" value={versionId} onChange={(event) => setVersionId(event.target.value)}>{model.versions.map((item) => <option value={item.id} key={item.id}>{item.version}</option>)}</select>}
        <button className="btn primary" disabled={busy || !selected} onClick={() => selected && void onDownload(selected)}><Download size={15} />下载</button>
        <button className="btn secondary" disabled={busy || !onUpdate} title={onUpdate ? "更新资料" : "该成果不能在此更新"} onClick={onUpdate}><Pencil size={15} />更新</button>
        <button className="btn secondary danger" disabled={busy || !onDelete} title={onDelete ? "删除后从页面隐藏，历史记录保留" : "该成果不能在此删除"} onClick={onDelete}><Trash2 size={15} />删除</button>
      </div>
    </section>
  );
}

export function ResourceDetail(props: Parameters<typeof ResourceDetailContent>[0]) {
  return <ResourceDetailContent key={props.model.id} {...props} />;
}
