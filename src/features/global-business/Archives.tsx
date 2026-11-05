import {useEffect,useState} from 'react';
import {X,RotateCcw} from 'lucide-react';
import {Dialog,DialogContent,DialogTitle} from '@/components/ui/dialog';
import {toast} from 'sonner';
import {localApi} from '@/lib/localApi';
import type {BusinessRow} from './types';
import {stringOf,businessDate} from './types';
const labels:Record<string,string>={projects:'业务项目',leads:'市场线索',knowledge:'产品资料',operations:'国家运营资源'};
export default function BusinessArchives({onClose,onRestored}:{onClose:()=>void;onRestored:()=>Promise<void>}){
 const [records,setRecords]=useState<Record<string,BusinessRow[]>>({}),[kind,setKind]=useState('projects'),[loading,setLoading]=useState(true),[saving,setSaving]=useState('');
 async function load(){setLoading(true);try{setRecords(await localApi('/api/global-business/archives'));}catch(e){toast.error(e instanceof Error?e.message:'归档记录读取失败');}finally{setLoading(false);}}
 useEffect(()=>{void load();},[]);
 async function restore(row:BusinessRow){setSaving(row.id);try{await localApi('/api/global-business/'+kind+'/'+row.id+'/restore',{method:'POST',body:JSON.stringify({revision:row.revision})});await load();await onRestored();toast.success('记录已恢复');}catch(e){toast.error(e instanceof Error?e.message:'恢复失败');}finally{setSaving('');}}
 const rows=records[kind]||[];
 return <Dialog open onOpenChange={opened=>{if(!opened&&!saving)onClose();}}><DialogContent className="gb-resource-modal gb-archives-modal" showCloseButton={false}><header><DialogTitle asChild><h3>归档记录</h3></DialogTitle><button aria-label="关闭归档记录" onClick={onClose} disabled={!!saving}><X size={18}/></button></header><div className="gb-archive-tabs">{Object.entries(labels).map(([key,label])=><button key={key} aria-pressed={kind===key} onClick={()=>setKind(key)} disabled={!!saving}>{label+' '+(records[key]?.length||0)}</button>)}</div><div className="gb-archive-table"><table><thead><tr><th>名称</th><th>国家 / 产品</th><th>归档时间</th><th>操作</th></tr></thead><tbody>{rows.map(row=><tr key={row.id}><td>{stringOf(row,'name')||stringOf(row,'title')}</td><td>{stringOf(row,'country')||stringOf(row,'product')||'—'}</td><td>{businessDate(stringOf(row,'updated_at'))}</td><td><button className="btn" disabled={!!saving} onClick={()=>void restore(row)}><RotateCcw size={13}/>{saving===row.id?'恢复中…':'恢复'}</button></td></tr>)}</tbody></table>{!rows.length&&<div className="gb-empty">{loading?'正在读取归档记录…':'暂无归档记录'}</div>}</div><footer><span>按类别显示最近 200 条归档记录</span><button className="btn" onClick={onClose} disabled={!!saving}>关闭</button></footer></DialogContent></Dialog>;
}
