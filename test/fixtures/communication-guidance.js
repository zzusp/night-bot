import assert from 'node:assert/strict'
import {communicationGuidanceIndex,taskPublicCommunicationInstructions} from '../../src/channels/message-safety.js'

// Inspect actual provider requests after Pi has executed the native reader.
export function assertSharedCommunicationGuidance(initial,loaded) {
  assert.ok(initial.tools.some(tool=>tool.function.name==='communication_guidance_read'),'native reader is available to each role')
  const prompt=initial.messages.filter(message=>['system','developer'].includes(message.role)).map(message=>message.content).join('\n')
  assert.equal(prompt.split(communicationGuidanceIndex).length-1,1,'one shared index per role')
  assert.doesNotMatch(prompt,/默认用 ELI5|NIGHT_TASK_PUBLIC_COMMUNICATION/,'full guidance is loaded on demand')
  const values=loaded.messages.filter(message=>message.role==='tool').flatMap(message=>typeof message.content==='string'?[message.content]:(message.content??[]).filter(part=>part.type==='text').map(part=>part.text))
  const guidance=values.map(text=>{try{return JSON.parse(text)}catch{return null}}).find(value=>value?.id==='communication/v1')
  assert.deepEqual(guidance,{id:'communication/v1',content:taskPublicCommunicationInstructions},'each role reads exactly the same current guideline version')
  assert.ok(guidance.content.includes('交流时遵循其要求：“默认用 ELI5 的方式和我说话，如果我要求则深入讲解”。默认讲人话、少用术语，必要术语随手解释，不幼稚化。'))
  assert.doesNotMatch(guidance.content,/与当前用户本人交流|面向第三方的正文仍按/)
  assert.match(guidance.content,/按实际读者、当前线程和问题选择信息/)
  assert.match(guidance.content,/不授予创建 Issue、发表评论、修改仓库、合并或部署权限/)
}
