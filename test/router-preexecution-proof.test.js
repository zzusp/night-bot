import test from 'node:test'
import assert from 'node:assert/strict'
import {independentRouterFileEffect} from '../src/runtime/pi-router-recovery-view.js'
import {recordRouterNotStarted,routerCallNotStarted,routerPreexecutionFailure,isRouterPreexecutionFailure} from '../src/runtime/router-preexecution-proof.js'

function fixture(){
 const call={type:'toolCall',id:'exact-call',name:'resident_task_action',arguments:{taskId:'existing',kind:'resume'}},assistant={type:'message',id:'assistant',message:{role:'assistant',content:[]}}
 assistant.message.content.push(call)
 const entries=[assistant],sessionId='router-session',packetId='frozen-packet',content=[{type:'text',text:'Guard rejected'}]
 const owner={id:sessionId,metadata:{runtimeOwner:'conversation-router'},admission:{current:()=>({id:packetId})},ctx:{get:()=>new Map([[sessionId,owner]])},piSession:{sessionManager:{getSessionId:()=>sessionId,getBranch:()=>entries,getEntries:()=>entries}},audit:{append(type,payload){assert.equal(type,'router-tool/not-started');entries.push({type:'custom',customType:'night.audit',data:{domain:'router-tool',kind:'not-started',payload}})}}}
 const record=(extra={})=>recordRouterNotStarted(owner,{toolName:call.name,callId:call.id,args:call.arguments,content,stage:'router-guard',...extra})
 const result={type:'message',id:'result',message:{role:'toolResult',toolCallId:call.id,toolName:call.name,isError:true,content}}
 const check=()=>routerCallNotStarted(entries,{sessionId,packetId,assistant,call,result})
 return {call,assistant,entries,owner,record,result,check}
}
test('only the trusted pre-business error capability is recognized',()=>{
 assert.equal(isRouterPreexecutionFailure(new Error('ROUTER_PRIOR_SESSION_EFFECT_UNKNOWN')),false)
 assert.equal(isRouterPreexecutionFailure({code:'ROUTER_PRIOR_SESSION_EFFECT_UNKNOWN'}),false)
 assert.equal(isRouterPreexecutionFailure(routerPreexecutionFailure('ROUTER_PRIOR_SESSION_EFFECT_UNKNOWN')),true)
})
test('durable proof binds exact session, packet, caller, arguments and actual error content',()=>{
 const f=fixture();f.record();f.record();f.entries.push(f.result);assert.equal(f.check(),true)
 assert.equal(f.entries.length,3,'same exact proof is idempotent')
 for(const [object,key,value] of [[f.entries[1].data.payload,'sessionId','other'],[f.entries[1].data.payload,'packetId','other'],[f.entries[1].data.payload,'assistantEntryId','other'],[f.entries[1].data.payload,'callId','other'],[f.entries[1].data.payload,'stage','untrusted'],[f.result.message,'toolName','other'],[f.result.message,'toolCallId','other'],[f.result.message,'content',[{type:'text',text:'different error'}]],[f.call,'arguments',{taskId:'other'}]]){
  const prior=object[key];object[key]=value;assert.equal(f.check(),false,key);object[key]=prior
 }
 f.entries.splice(1,0,structuredClone(f.entries[1]));assert.equal(f.check(),false,'ambiguous proof rejected')
})
test('ordinary errors, absent/late proofs and ambiguous prepare calls cannot clear effects',()=>{
 const f=fixture();f.entries.push(f.result);assert.equal(f.check(),false)
 f.result.message.details={notStarted:true,code:'ROUTER_PRIOR_SESSION_EFFECT_UNKNOWN'};assert.equal(f.check(),false)
 f.record();assert.equal(f.check(),false,'proof after result cannot authorize recovery')
 const ambiguous=fixture();ambiguous.assistant.message.content.push({...ambiguous.call,id:'other-call'});ambiguous.record({callId:undefined});assert.equal(ambiguous.entries.length,1)
 const foreign=fixture();foreign.owner.ctx.get=()=>new Map();foreign.record();assert.equal(foreign.entries.length,1)
})


test('a new file request does not replace overlapping unknown effects in a retired Router',()=>{
 const f=fixture()
 const {entries,call,result,assistant}=f
 const sourceId='original-source',tool='resident_router_shared_import'
 const current={name:tool,args:{taskId:'existing',sourceId:'fresh-source',messageVersion:1}}
 const inspect=()=>independentRouterFileEffect({header:{id:f.owner.id},entries},current)
 assert.equal(inspect(),true,'an unknown ordinary task action is not an import')
 call.name=tool;Object.assign(call.arguments,{sourceId,messageVersion:1});result.message.toolName=tool
 assert.equal(inspect(),false,'an unpaired import on the original task must not be replaced')
 call.arguments.taskId='different-task';assert.equal(inspect(),true);call.arguments.taskId='existing'
 entries.push(result);assert.equal(inspect(),false,'an error alone proves no outcome')
 result.message.details={nativeResult:{value:{verified:true}}};assert.equal(inspect(),false,'an error with a verification flag is not a success')
 result.message.isError=false;result.parentId=assistant.id;assert.equal(inspect(),true,'a verified committed import is no longer unknown')
 current.args.sourceId=sourceId;assert.equal(inspect(),false,'the original source cannot be reused')
 current.name='resident_router_reply';current.args={sourceId:'fresh-send',messageVersion:1,taskDelivery:{taskId:'existing'}}
 call.name=current.name;call.arguments={sourceId,messageVersion:1,taskDelivery:{taskId:'existing'}};result.message.toolName=current.name
 assert.equal(inspect(),false,'a successful reply that only queued an attachment is not a delivery proof')
})
