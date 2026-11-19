import {checkedText} from '../memory/format.js'

export const TRIAGE_CONCLUSION_LIMIT=400
const fail=()=>{throw Object.assign(new Error('ROUTER_TRIAGE_BINDING_INVALID'),{code:'ROUTER_TRIAGE_BINDING_INVALID'})}
// A semantic assessment, never an authorization or a delivery/task receipt.
export function triageHandoff(value){
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!['assignment','summary'].includes(key))||!['explicit','uncertain'].includes(value.assignment)||typeof value.summary!=='string'||!value.summary.trim()||value.summary.length>TRIAGE_CONCLUSION_LIMIT)fail()
 return {assignment:value.assignment,summary:checkedText(value.summary)}
}
export function routerTriageConclusion(event){
 const value=event.triageConclusion
 if(value===undefined)return undefined
 const source=event.source
 if(event.kind!=='source.message'||!source||!value||value.decisionId!==event.triageDecisionId||value.decisionId!==`triage:${event.sourceId}`||value.conversationId!==event.conversationId||value.conversationId!==(source.conversationId??source.groupId)||source.groupId!==undefined&&source.groupId!==value.conversationId||value.sourceId!==event.sourceId||value.sourceId!==source.sourceId||value.messageVersion!==event.messageVersion||value.messageVersion!==source.version)fail()
 return {decisionId:value.decisionId,conversationId:value.conversationId,sourceId:value.sourceId,messageVersion:value.messageVersion,...triageHandoff({assignment:value.assignment,summary:value.summary})}
}
