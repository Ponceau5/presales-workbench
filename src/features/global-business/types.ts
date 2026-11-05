export type BusinessRow={id:string;revision:number;[key:string]:unknown};
export type BusinessData={projects:BusinessRow[];leads:BusinessRow[];knowledge:BusinessRow[];operations:BusinessRow[];can_edit:boolean;updates:{id:string;record_type:string;record_id:string;action:string;created_at:string}[]};
export const stages=['线索池','前期接触','方案沟通','招标中','已中标','实施中','验收完毕','未中标'];
export const delivery=['待建立','资料与需求','方案与配置','成本与报价','合同与风险','交接与交付','已完成'];
export const regions=['亚太区','中国区','美洲区','欧洲区','中东区','非洲区'];
export const stringOf=(row:BusinessRow,key:string)=>String(row[key]??'');
export const valueOf=(row:BusinessRow,key:string)=>Number(row[key]||0);
export const countryName=(name:string)=>({'马来':'马来西亚','印尼':'印度尼西亚','香港':'中国香港','北美':'美国','RUS':'俄罗斯'}[name]||name||'待补充');
export const groupCounts=(rows:BusinessRow[],key:string)=>Object.entries(rows.reduce<Record<string,number>>((acc,row)=>{const name=key==='country'?countryName(stringOf(row,key)):stringOf(row,key)||'待补充';acc[name]=(acc[name]||0)+1;return acc;},{})).sort((a,b)=>b[1]-a[1]);
export const numberLabel=(n:number)=>n.toLocaleString('zh-CN',{maximumFractionDigits:1});

export const productText=(value:unknown)=>typeof value==='object'&&value!==null?Object.entries(value).map(([key,text])=>key+'：'+text).join('\n'):String(value||'');
export function productValues(value:unknown){if(typeof value!=='string')return value;if(!value.trim())return {};if(value.trim().startsWith('{'))return JSON.parse(value);return Object.fromEntries(value.split(/\r?\n/).filter(line=>line.trim()).map(line=>{const pos=line.search(/[：:]/);if(pos<1)throw new Error('产品与供货情况请按“产品：供货说明”逐行填写');return [line.slice(0,pos).trim(),line.slice(pos+1).trim()];}));}



export const businessDate=(value:string)=>!value?'—':/^\d{4}-\d{2}-\d{2}$/.test(value)?value:Number.isNaN(Date.parse(value))?'—':new Date(value).toLocaleDateString('sv-SE');
