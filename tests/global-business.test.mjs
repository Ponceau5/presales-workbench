import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import ts from 'typescript';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
const require=createRequire(import.meta.url);
function moduleUrl(file,imports={},replace={}){
 let source=readFileSync(file,'utf8');for(const [from,to] of Object.entries(replace))source=source.replace(from,to);
 let code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 for(const [name,url] of Object.entries({'react':pathToFileURL(require.resolve('react')).href,'react/jsx-runtime':pathToFileURL(require.resolve('react/jsx-runtime')).href,'lucide-react':pathToFileURL(require.resolve('lucide-react')).href,...imports}))code=code.replaceAll("'"+name+"'",JSON.stringify(url)).replaceAll('"'+name+'"',JSON.stringify(url));
 return 'data:text/javascript;base64,'+Buffer.from(code).toString('base64');
}
const typesUrl=moduleUrl('src/features/global-business/types.ts');
const domain=await import(typesUrl);
const {default:Overview}=await import(moduleUrl('src/features/global-business/Overview.tsx',{'./types':typesUrl}));
const {default:Opportunity}=await import(moduleUrl('src/features/global-business/Opportunity.tsx',{'./types':typesUrl}));
const shapes=readFileSync('src/features/global-business/world-map.json','utf8');
const {default:WorldMap}=await import(moduleUrl('src/features/global-business/WorldMap.tsx',{}, {"import shapes from './world-map.json';":'const shapes='+shapes+';'}));
const row=(id,stage,extra={})=>({id,revision:1,name:'项目'+id,country:'泰国',region:'亚太区',stage,delivery_stage:'待建立',mw:0,amount:null,...extra});
test('overview renders all reference sections and derives explicit decision and delivery counts',()=>{
 const projects=[row('a','已中标',{mw:12}),row('b','未中标'),row('c','未中标'),row('d','实施中'),row('e','招标中',{follow_up:'等待客户技术确认'})];
 const html=renderToStaticMarkup(React.createElement(Overview,{projects,onFilter(){},onOpen(){}}));
 for(const label of ['售前交付进度','商机 → 合同 → 交付','区域分布','重点国家 / 地区','招标中重点项目','最新跟进与下一步','33.3%','12 MW','等待客户技术确认'])assert.ok(html.includes(label),label);
 assert.ok(!html.includes('NaN'));assert.ok(!html.includes('Infinity'));
});
test('empty overview keeps meaningful sections and zero values without fabricated percentages',()=>{
 const html=renderToStaticMarkup(React.createElement(Overview,{projects:[],onFilter(){},onOpen(){}}));
 assert.ok(html.includes('决标结果待登记'));assert.ok(html.includes('暂无招标中项目'));assert.ok(!html.includes('NaN'));assert.ok(!html.includes('Infinity'));
});
test('market list includes prospects and excludes already delivered work',()=>{
 const html=renderToStaticMarkup(React.createElement(Opportunity,{projects:[row('prospect','方案沟通'),row('delivered','验收完毕')],leads:[],canEdit:true,onProject(){},onRegister(){}}));
 assert.ok(html.includes('项目prospect'));assert.ok(!html.includes('项目delivered'));assert.ok(html.includes('登记 / 维护线索'));
});
test('world map keeps real country boundaries and exact country counts',()=>{
 const html=renderToStaticMarkup(React.createElement(WorldMap,{counts:[['泰国',26],['马来西亚',51]],selected:'泰国',onSelect(){}}));
 assert.ok(html.includes('全球项目分布地图'));assert.ok(html.includes('泰国 · 26 个项目'));assert.ok(html.includes('马来西亚 · 51 个项目'));assert.ok((html.match(/<path/g)||[]).length>150);assert.ok(!html.includes('NaN'));
});
test('human readable supply descriptions round trip without losing punctuation',()=>{
 const input={'BMS':'CET；供货范围待确认','仪表':'iMeter 7A：需认证核对'};
 assert.deepEqual(domain.productValues(domain.productText(input)),input);assert.deepEqual(domain.productValues(JSON.stringify(input)),input);assert.throws(()=>domain.productValues('缺少产品与说明分隔符'),/产品：供货说明/);
 assert.deepEqual(domain.groupCounts([row('a','线索池',{country:'RUS'}),row('b','线索池',{country:'俄罗斯'})],'country'),[['俄罗斯',2]]);
});

test('calendar dates remain calendar dates and missing dates render as missing',()=>{assert.equal(domain.businessDate('2026-11-06'),'2026-11-06');assert.equal(domain.businessDate(''),'—');assert.equal(domain.businessDate('invalid'),'—');});
