import intentCases from './communication-intent-cases.json' with {type:'json'}
import assert from 'node:assert/strict'
import {communicationReplyPrinciple,communicationGuidanceIndex,taskPublicCommunicationInstructions} from '../../src/channels/message-safety.js'

// Inspect actual provider requests after Pi has executed the native reader.
export function assertSharedCommunicationGuidance(initial,loaded) {
  assert.ok(initial.tools.some(tool=>tool.function.name==='communication_guidance_read'),'native reader is available to each role')
  const prompt=initial.messages.filter(message=>['system','developer'].includes(message.role)).map(message=>message.content).join('\n')
  assert.equal(prompt.split(communicationGuidanceIndex).length-1,1,'one shared index in the Router system prompt')
  assert.equal(prompt.split(communicationReplyPrinciple).length-1,1,'one shared principle in the Router system prompt')
  assert.match(prompt,/默认 ELI5：先直接回答对方问的事/u)
  assert.match(prompt,/未明确要求明细，只写结论和下一步/u)
  assert.match(prompt,/不因问题复杂、正式排查、结果交付或多个问题而例外/u)
  assert.match(prompt,/禁止防御性内容，不只是避开某些词/u)
  assert.doesNotMatch(prompt,/复杂问题把关键依据说透|有帮助的依据不要省/u)
  assert.doesNotMatch(prompt,/NIGHT_TASK_PUBLIC_COMMUNICATION|在测试环境验证后确认/, 'no detailed template or test-specific phrasing in the default prompt')
  const values=loaded.messages.filter(message=>message.role==='tool').flatMap(message=>typeof message.content==='string'?[message.content]:(message.content??[]).filter(part=>part.type==='text').map(part=>part.text))
  const guidance=values.map(text=>{try{return JSON.parse(text)}catch{return null}}).find(value=>value?.id==='communication/v1')
  assert.deepEqual(guidance,{id:'communication/v1',content:taskPublicCommunicationInstructions},'each role reads exactly the same current guideline version')
  assert.equal(guidance.content.split(communicationReplyPrinciple).length-1,1,'reader includes one full principle for execution sessions that only load the index')
  const combined=prompt+'\n'+guidance.content
  const loadedPrompt=loaded.messages.filter(message=>['system','developer'].includes(message.role)).map(message=>message.content).join('\n')
  assert.equal(loadedPrompt.split(communicationReplyPrinciple).length-1,1,'subsequent request retains a single static principle')
  for(const boundary of ['接收者','权限','仓库模板','机器可读参数','原始记录','安全审计','未知提交结果先回读原效果'])assert.ok(guidance.content.includes(boundary),boundary)
  assert.doesNotMatch(guidance.content,/与当前用户本人交流|面向第三方的正文仍按/)
  // Reference replies are acceptance examples, not outputs from a real model.
  // These assertions verify only that all roles receive the general principles.
  for(const sample of intentCases)for(const anchor of sample.policyAnchors)assert.ok(combined.includes(anchor),sample.intent+' principle is shared')
  assert.doesNotMatch(guidance.content,/#452|SimaPro|ILCD/,'acceptance particulars do not become prompt rules')
  assert.doesNotMatch(guidance.content,/承接纠正的取舍示例|找错 Pod|UAT2|已收到您的需求|要我顺手修掉吗/,'examples remain test data only')
  assert.match(guidance.content,/只有确实会在恢复后接续且授权允许时才承诺接续/)
  assert.match(guidance.content,/上面的 ELI5 原则仅适用于写给人的正文/u)
  assert.doesNotMatch(guidance.content,/只报告有对应版本及证据/, 'supplemental guidance does not require test evidence for all replies')
  assert.match(guidance.content,/不授予创建 Issue、发表评论、修改仓库、合并或部署权限/)
}
