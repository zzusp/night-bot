import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
const source=readFileSync(new URL('../src/token-format.ts',import.meta.url),'utf8');
const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const {formatTokenCount,exactTokenCount}=await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
test('compact token display rounds once, trims zeroes and promotes K/M boundaries',()=>{
 for(const [raw,display] of [[0,'0'],[999,'999'],[1000,'1K'],[1200,'1.2K'],[2100,'2.1K'],[8400,'8.4K'],[11130,'11.1K'],[1249,'1.2K'],[1250,'1.3K'],[999949,'999.9K'],[999950,'1M'],[999999,'1M'],[1000000,'1M'],[1200000,'1.2M'],[999949999,'999.9M'],[999950000,'1B'],[999999999,'1B'],[1000000000,'1B'],[1100000000,'1.1B'],[1600012400,'1.6B'],[Number.MAX_SAFE_INTEGER,'9007199.3B']]) assert.equal(formatTokenCount(raw),display,String(raw));
});
test('missing and invalid counts never become zero; precise raw values remain available',()=>{
 for(const raw of [null,undefined,NaN,Infinity,-Infinity,-1,1.2,'1200',{},Number.MAX_SAFE_INTEGER+1]){assert.equal(formatTokenCount(raw),'未知');assert.equal(exactTokenCount(raw),'未知');}
 assert.equal(exactTokenCount(1100000000),'1,100,000,000');assert.equal(exactTokenCount(0),'0');
});
