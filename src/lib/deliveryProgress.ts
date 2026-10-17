import type {ProjectSnapshot} from '@/state/workbench';
export const deliveryGroups=[
 {id:'scope',name:'资料与需求',hint:'F1–F2 · 建档与需求澄清',color:'#53bfd6'},
 {id:'solution',name:'方案与配置',hint:'F3–F6 · 点表、选型与可行性',color:'#9a8be5'},
 {id:'quote',name:'成本与报价',hint:'F7–F10 · 询价、BOQ 与投标',color:'#e5b35b'},
 {id:'contract',name:'合同与风险',hint:'F11–F13 · 合同与财税核对',color:'#60cfa1'},
 {id:'done',name:'交接与变更',hint:'成果交接 · 实施变更 · 验收',color:'#59bbcb'},
 {id:'closed',name:'已结束',hint:'结果留存与经验复盘',color:'#8397bb'},
 {id:'untracked',name:'待建立进度',hint:'已有项目档案，尚无工件进度',color:'#8993a5'},
];
export function deliveryProgress(snapshot?:Pick<ProjectSnapshot,'stageStates'>,registeredStage?:string){
 const stages=Array.from({length:13},(_,i)=>{const id='F'+(i+1),s=snapshot?.stageStates?.[id];return {id,state:s?.change?'changed':s?.written?'done':s?.generated?'review':'waiting'};});
 const done=stages.filter(s=>s.state==='done').length,review=stages.filter(s=>s.state==='review').length,changed=stages.filter(s=>s.state==='changed').length;
 const next=stages.findIndex(s=>s.state!=='done');
 const recorded=done+review+changed>0;
 const registered:Record<string,string>={lead:'scope',opportunity:'solution',tender:'quote',won:'contract',delivery:'done',acceptance:'done',lost:'closed'};
 const group=recorded?(next<0?'done':next<2?'scope':next<6?'solution':next<10?'quote':'contract'):(registered[registeredStage||'']||'untracked');
 return {stages,done,review,changed,group,recorded,percent:Math.round(done/13*100)};
}
