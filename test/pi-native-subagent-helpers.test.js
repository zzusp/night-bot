import test from 'node:test'
import assert from 'node:assert/strict'
import * as native from '../src/native-subagents.js'
import {canonicalClientTimeZone} from '../src/native-time-zone.js'

test('delegation depth cannot fall below persisted lineage and rejects invalid runtime depth',()=>{
 const parent={options:{subagentDepth:0},session:{header:{delegationDepth:3}}}
 assert.equal(native.delegationDepthOf(parent),3)
 assert.equal(native.resolveChildDepth(parent,4),4)
 assert.equal(native.resolveChildDepth(parent),4)
 assert.throws(()=>native.resolveChildDepth(parent,3),native.SubagentDepthError)
 for(const value of [-1,-0,1.5,NaN,Infinity,'1'])assert.throws(()=>native.delegationDepthOf({...parent,options:{subagentDepth:value}}),TypeError)
 assert.throws(()=>native.resolveChildDepth({...parent,options:{subagentDepth:Number.MAX_SAFE_INTEGER}}),RangeError)
})
test('children inherit the current model route and a changed route clears route-specific reasoning',()=>{
 const parent={options:{provider:'old',model:'old-model',reasoningEffort:'high',maxTokens:128},session:{requestHeader:()=>({config:{provider:'current',model:'current-model',reasoningEffort:'low'}})}}
 assert.deepEqual(native.resolveChildAgentOptions(parent,undefined,4),{provider:'current',model:'current-model',reasoningEffort:'low',maxTokens:128,subagentDepth:4})
 assert.deepEqual(native.resolveChildAgentOptions(parent,{model:'other'},4),{provider:'current',model:'other',maxTokens:128,subagentDepth:4})
 assert.equal(native.resolveChildAgentOptions(parent,{model:'other',reasoningEffort:'high'},4).reasoningEffort,'high')
 const metadata=native.childSessionMeta({session:{header:{id:'parent',cwd:'/fixture'}},ctx:{get:()=>({composedPreset:()=> 'live-preset'})}},4,true)
 assert.deepEqual(metadata,{cwd:'/fixture',agentPreset:'live-preset',parentSession:'parent',isSeeded:true,origin:'subagent',delegationDepth:4})
})
test('child descriptors detach caller data and only the establishing descriptor owns composition',()=>{
 const input={mode:'continuable',provider:'spawn',label:'fixture',toolFilter:{allow:['read']},agentProvider:'p',agentModel:'a'},descriptor=native.snapshotSubagentDescriptor(input)
 input.toolFilter.allow.push('write')
 assert.deepEqual(descriptor,{version:3,mode:'continuable',provider:'spawn',label:'fixture',toolFilter:{allow:['read']},agentProvider:'p',agentModel:'a'})
 assert.deepEqual(native.foldSubagentDescriptor([{type:'subagent/descriptor',data:descriptor},{type:'subagent/descriptor',data:{version:999}}]),descriptor)
 assert.equal(native.foldSubagentDescriptor([{type:'subagent/descriptor',data:{version:999}},{type:'subagent/descriptor',data:descriptor}]),undefined)
 assert.throws(()=>native.foldSubagentDescriptor([{type:'subagent/descriptor',data:{version:3}}]))
})
test('caller zones accept canonical named zones and reject offsets, aliases and malformed inputs',()=>{
 for(const [input,expected] of [['UTC','UTC'],['Asia/Shanghai','Asia/Shanghai'],['America/New_York','America/New_York'],['Etc/GMT+5','Etc/GMT+5'],['GMT',undefined],[' UTC',undefined],['Invalid/Zone',undefined],['UTC+5',undefined],['',undefined]])assert.equal(canonicalClientTimeZone(input),expected)
})
