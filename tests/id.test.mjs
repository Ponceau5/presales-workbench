import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { webcrypto } from "node:crypto";
import ts from "typescript";
const js = ts.transpileModule(readFileSync("src/lib/id.ts", "utf8"), {compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText;
test("HTTP context without randomUUID can create unique RFC4122 IDs", () => {
 const exports = {};
 runInNewContext(js, {exports, crypto:{getRandomValues: bytes => webcrypto.getRandomValues(bytes)}});
 const ids = Array.from({length:100}, () => exports.randomId());
 assert.equal(new Set(ids).size, 100);
 for (const id of ids) assert.match(id,/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});
test("HTTPS context retains native UUID generation", () => {
 const exports = {};
 runInNewContext(js, {exports, crypto:{randomUUID:()=>"native-id"}});
 assert.equal(exports.randomId(),"native-id");
});
