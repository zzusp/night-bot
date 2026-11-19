import intentCases from './communication-intent-cases.json' with {type:'json'}
import assert from 'node:assert/strict'
import {communicationGuidanceIndex,taskPublicCommunicationInstructions} from '../../src/channels/message-safety.js'

// Inspect actual provider requests after Pi has executed the native reader.
export function assertSharedCommunicationGuidance(initial,loaded) {
  assert.ok(initial.tools.some(tool=>tool.function.name==='communication_guidance_read'),'native reader is available to each role')
  const prompt=initial.messages.filter(message=>['system','developer'].includes(message.role)).map(message=>message.content).join('\n')
  assert.equal(prompt.split(communicationGuidanceIndex).length-1,1,'one shared index per role')
  assert.doesNotMatch(prompt,/默认 ELI5 方式交流|NIGHT_TASK_PUBLIC_COMMUNICATION/,'full guidance is loaded on demand')
  const values=loaded.messages.filter(message=>message.role==='tool').flatMap(message=>typeof message.content==='string'?[message.content]:(message.content??[]).filter(part=>part.type==='text').map(part=>part.text))
  const guidance=values.map(text=>{try{return JSON.parse(text)}catch{return null}}).find(value=>value?.id==='communication/v1')
  assert.deepEqual(guidance,{id:'communication/v1',content:taskPublicCommunicationInstructions},'each role reads exactly the same current guideline version')
  assert.ok(guidance.content.includes('接活就接住，问进度就说做到哪、还差什么，对方接手就确认停下。默认 ELI5 方式交流，不复述、不汇报过程，追问时再展开。'))
  assert.doesNotMatch(guidance.content,/与当前用户本人交流|面向第三方的正文仍按/)
  // Reference replies are acceptance examples, not outputs from a real model.
  // These assertions verify only that all roles receive the general principles.
  for(const sample of intentCases)for(const anchor of sample.policyAnchors)assert.ok(guidance.content.includes(anchor),sample.intent+' principle is shared')
  assert.doesNotMatch(guidance.content,/#452|SimaPro|ILCD/,'acceptance particulars do not become prompt rules')
  assert.match(guidance.content,/承接纠正的取舍示例.*找错 Pod.*403/)
  assert.match(guidance.content,/只有确实会在恢复后接续才作承诺/)
  assert.match(guidance.content,/按实际读者、当前线程和问题选择信息/)
  assert.match(guidance.content,/不授予创建 Issue、发表评论、修改仓库、合并或部署权限/)
}
