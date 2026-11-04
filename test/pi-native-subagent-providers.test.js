import test from 'node:test'
import assert from 'node:assert/strict'
import {localSubagentProvider} from '../src/native-subagent-providers.js'
async function prior(name){let provider;const {apply}=await import('@deepseek-ai/dsh-subagent-'+name+'-in-process');apply({subagents:{registerProvider:value=>provider=value}},{providerName:name});return provider}
for(const name of ['spawn','fork'])test('native '+name+' provider retains local start capabilities and completed-turn seed contract',async()=>{
 const actual=localSubagentProvider(name,name==='fork'),old=await prior(name)
 assert.deepEqual(actual.capabilities,old.capabilities);assert.equal(actual.inheritsParentContext,old.inheritsParentContext)
 for(const events of [[],[{seq:0,type:'turn/start'}],[{seq:0,type:'turn/start'},{seq:1,type:'turn/end'},{seq:2,type:'turn/start'},{seq:3,type:'tool/call'}],[{seq:0,type:'turn/end'},{seq:1,type:'turn/start'},{seq:2,type:'turn/end'},{seq:3,type:'turn/start'}]]){
  const parent={session:{snapshotEvents:()=>events}},request={parent};assert.deepEqual(await actual.prepareContinuable(request),await old.prepareContinuable(request));assert.equal(parent.session.snapshotEvents(),events)
 }
})
test('spawn never reads parent history and fork preserves exact immutable event identities with a detached prefix array',async()=>{assert.deepEqual(await localSubagentProvider('spawn').prepareContinuable({parent:{session:{snapshotEvents(){throw new Error('spawn must not inherit history')}}}}),{});const event=Object.freeze({seq:0,type:'turn/end'}),events=Object.freeze([event,Object.freeze({seq:1,type:'turn/start'})]),result=await localSubagentProvider('fork',true).prepareContinuable({parent:{session:{snapshotEvents:()=>events}}});assert.equal(result.seed[0],event);result.seed.push({seq:1});assert.equal(events.length,2)})
