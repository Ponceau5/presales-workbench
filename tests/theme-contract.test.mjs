import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
test('shell and embedded exhibition load the same theme stylesheet',()=>{
 for(const path of ['index.html','public/brand-promotion/2027-events.html'])assert.match(read(path),/href="\/theme\.css"/);
 const palette=read('public/theme.css');for(const name of ['app-bg','surface','surface-soft','text','text-secondary','line','accent-blue'])assert.match(palette,new RegExp('--'+name+':'));
});
test('dashboard and exhibition cannot define independent surface palettes',()=>{
 for(const path of ['src/features/global-business/global-dashboard.css','src/pages/global-business.css']) assert.doesNotMatch(read(path),/--(?:surface|surface-soft|app-bg|text|line)\s*:/);
 const css=read('public/brand-promotion/2027-events.html').match(/<style>([\s\S]*?)<\/style>/)[1];
 assert.doesNotMatch(css,/#[\da-f]{3,8}\b/i);assert.doesNotMatch(css,/var\(--var\(/);assert.match(css,/background:var\(--surface\)/);
 assert.doesNotMatch(read('src/features/global-business/country-operations.css'),/#[\da-f]{3,8}\b/i);
});
