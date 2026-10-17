export type PortfolioStage = 'lead'|'opportunity'|'tender'|'won'|'delivery'|'acceptance'|'lost';
export interface PortfolioRecord {
  id:string; code:string; name:string; country:string; region:string; park:string;
  owner:string; endUser:string; contractor:string; consultant:string; bidStatus:string;
  rawProgress:string; pic:string; stage:PortfolioStage; products:{name:string;value:string}[];
  timeline:{date:string;text:string}[]; notes:string; lastUpdate:string|null;
  risk:'normal'|'warning'|'critical'; sourceUrl?:string;
}
export const portfolioStages:{id:PortfolioStage;name:string;hint:string;color:string}[]=[
  {id:'lead',name:'线索',hint:'信息收集',color:'#8397bb'},
  {id:'opportunity',name:'商机',hint:'方案与技术交流',color:'#53bfd6'},
  {id:'tender',name:'投标',hint:'配置 · 询价 · BOQ 报价',color:'#e5b35b'},
  {id:'won',name:'中标',hint:'商务与合同确认',color:'#60cfa1'},
  {id:'delivery',name:'实施',hint:'发货 · 调试 · 变更',color:'#9a8be5'},
  {id:'acceptance',name:'验收',hint:'验收与回款',color:'#59bbcb'},
  {id:'lost',name:'未中标',hint:'结果与原因留存',color:'#8993a5'}
];
export const portfolioCountries=[{id:'MY',name:'马来西亚',color:'#58cadb'},{id:'ID',name:'印度尼西亚',color:'#b794eb'},{id:'TH',name:'泰国',color:'#e9a16b'}];
export function followupNeeded(p:PortfolioRecord){return p.risk!=='normal'||(p.stage==='tender'&&!p.lastUpdate);}
export function cleanPortfolioText(value:string){return !value||value==='nan'?'':value.trim();}
