import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import ts from 'typescript';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
const require=createRequire(import.meta.url);
let code=ts.transpileModule(readFileSync('src/features/software/MarkdownReply.tsx','utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}}).outputText;
const imports={'react':pathToFileURL(require.resolve('react')).href,'react/jsx-runtime':pathToFileURL(require.resolve('react/jsx-runtime')).href,'@/lib/vendor/marked':pathToFileURL(process.cwd()+'/src/lib/vendor/marked.js').href,'@/lib/localApi':'data:text/javascript,export const localApiBase=""'};
for(const [name,url] of Object.entries(imports))code=code.replaceAll(JSON.stringify(name),JSON.stringify(url));
const {MarkdownReply}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
const render=text=>renderToStaticMarkup(React.createElement(MarkdownReply,{text}));
test('model HTML is escaped rather than executed',()=>{
 const html=render('<script>alert(1)</script><img src=x onerror=alert(1)>');
 assert.ok(!html.includes('<script>'));assert.ok(!html.includes('<img '));assert.ok(html.includes('&lt;script&gt;'));
});
test('model javascript and data links never become clickable',()=>{
 for(const link of ['javascript:alert(1)','data:text/html,test','file:///etc/passwd'])assert.ok(!render(`[打开](${link})`).includes('<a '));
});
test('model remote image cannot silently load a tracking URL',()=>{
 const html=render('![test](https://example.invalid/track?secret=fixture)');assert.ok(!html.includes('<img'));assert.ok(!html.includes('src="https://'));
});
test('ordinary model table and HTTPS source remain readable',()=>{
 const html=render('| 型号 | 数量 |\n| --- | --- |\n| A | 3 |\n\n[来源](https://example.com/manual)');assert.ok(html.includes('<table>'));assert.ok(html.includes('href="https://example.com/manual"'));assert.ok(html.includes('rel="noreferrer"'));
});
