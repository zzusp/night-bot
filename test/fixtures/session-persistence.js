import {deepFreeze} from '../../src/native-values.js'
import {convertToLlm} from '@earendil-works/pi-coding-agent'
import {piRequestContext,piRequestEvent,piRequestSource} from '../../src/runtime/pi-request-context.js'
import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

// Keep test doubles on the same read-handle boundary as the native backend.
export function sessionPersistenceFixture(inspect) {
  return {
    async open(id, access) {
      assert.equal(access, 'read')
      const { meta, inheritedEventCount = 0, events } = await inspect(id)
      return {
        header: meta,
        inheritedEventCount,
        async read() { return { events } },
        async close() {},
      }
    },
  }
}

export const modelMessageParts=message=>typeof message.content==='string'?[{type:'text',text:message.content}]:message.content??[]
function instruction(message,request){
 if(message.role==='system')return message
 if(message.role!=='custom'||message.customType!=='night.system'||!piRequestContext(request))return undefined
 const entry=piRequestSource(request,message)
 if(entry?.type!=='custom_message'||entry.customType!=='night.system'||piRequestEvent(request,message)?.type!=='system/message')return undefined
 return {role:'system',content:message.content,timestamp:message.timestamp}
}
const capturedSystemText=new WeakMap()
export function captureModelRequest(request){const snapshot=deepFreeze(structuredClone(request));capturedSystemText.set(snapshot,requestSystemText(request));return snapshot}
export function requestSystemText(request){
 if(capturedSystemText.has(request))return capturedSystemText.get(request)
 return convertToLlm(request.messages.map(message=>instruction(message,request)).filter(Boolean))
  .flatMap(modelMessageParts).filter(part=>part.type==='text').map(part=>part.text).join('\n')
}
export function modelMessageSource(request,message){
 if(!piRequestContext(request))return message.source
 const entry=piRequestSource(request,message),event=piRequestEvent(request,message)
 return entry?.type==='message'&&entry.message.role==='user'&&event?.type==='user/message'?event.data.source:undefined
}
// Only provider-visible fields contribute to test budgets. Official messages can
// carry Night journal provenance that transports intentionally do not serialize.
export function providerContentMessages(request,messages=request.messages){
 return convertToLlm(messages.map(message=>instruction(message,request)??message)).map(message=>({role:message.role,content:message.content,
  ...message.role==='toolResult'?{toolCallId:message.toolCallId,toolName:message.toolName,isError:message.isError}:{},
  ...message.role==='system'?{...message.toolsAdded?{toolsAdded:message.toolsAdded}:{},...message.toolsRemoved?{toolsRemoved:message.toolsRemoved}:{}}:{},
 }))
}
export const providerRequestView=request=>({messages:providerContentMessages(request),tools:request.tools??[],...request.system?{system:request.system}:{}})

// Locate fixtures by the stored header rather than the backend's private path API.
export async function findSessionLog(root, id) {
  const matches = []
  for (const entry of await readdir(root, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.jsonl')) continue
    const path = join(entry.parentPath, entry.name)
    const header = JSON.parse((await readFile(path, 'utf8')).split('\n', 1)[0])
    if (header.id === id) matches.push(path)
  }
  assert.equal(matches.length, 1, `one persisted fixture log for ${id}`)
  return matches[0]
}
