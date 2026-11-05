export type InteractionNode={id:string;kind:"inspect"|"procurement"|"upload"|"parameters"|"calculate"|"review"|"export";title:string;presentation:"chat"|"panel";when:"always"|"missing_purchase";instruction:string};
export type InteractionFlow={navigation?:"free"|"guided";nodes:InteractionNode[]};
export type SkillProposal={id:string;task_id?:string;interaction?:InteractionFlow|null;task_name:string;markdown:string;previous:string;summary:string;status:"pending"|"confirmed"|"discarded";diff:string};
export function isFlowUpdateRequest(text:string){
 return /流程|交互|弹窗|确认方式|确认卡片/.test(text)&&/修改|调整|改成|更改|更新|增加|取消|去掉|不要|改为/.test(text)&&!/^.*(?:如何|怎么才能|能否).*修改/.test(text);
}
export function isSkillUpdateRequest(text:string){
 if(/^(?:请)?(?:不要|别|不用|不需要)(?:再|帮我)?(?:更新|修改|更改|改动|改|保存|沉淀)/.test(text))return false;
 if(isFlowUpdateRequest(text))return true;
 if(!/skill|技能/i.test(text)||!/更新|修改|沉淀|保存|写入|同步|记住|补充|完善|总结.*到/.test(text))return false;
 return /帮我|请|把|将|根据刚才|按照刚才/.test(text)||!/如何|怎么|能不能|是否|吗|[？?]/.test(text);
}
