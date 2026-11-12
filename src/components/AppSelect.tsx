import {Select,SelectTrigger,SelectValue,SelectContent,SelectItem} from '@/components/ui/select';
type Option={value:string;label:string};
export function AppSelect({label,value,onChange,options,disabled=false}:{label:string;value:string;onChange:(value:string)=>void;options:Option[];disabled?:boolean}){
 const encoded=(v:string)=>v===''?'__all__':v;
 return <Select value={encoded(value)} onValueChange={v=>onChange(v==='__all__'?'':v)} disabled={disabled}><SelectTrigger aria-label={label} className="app-select-trigger"><SelectValue/></SelectTrigger><SelectContent position="popper" align="start" className="app-select-menu">{options.map(o=><SelectItem key={o.value} value={encoded(o.value)}>{o.label}</SelectItem>)}</SelectContent></Select>;
}
