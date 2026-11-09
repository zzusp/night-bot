import { createAssistantMessage } from './native-message-protocol.js';
import { AssistantMessageEventStream } from '@earendil-works/pi-ai'

const parseArgs = raw => { try { return JSON.parse(raw || '{}') } catch { return raw } }
const emptyUsage = () => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } })
export const piUsage = usage => ({ inputTokens: usage.input, outputTokens: usage.output,
  cacheReadTokens: usage.cacheRead, cacheWriteTokens: usage.cacheWrite, totalTokens: usage.totalTokens })
export function fromPiAssistant(message) {
  return message.content.map(block => block.type === 'toolCall'
    ? { type: 'tool-call', id: block.id, name: block.name, arguments: JSON.stringify(block.arguments) }
    : block.type === 'thinking' ? { type: 'reasoning', text: block.thinking } : block)
}
export function piFailureStream(error, stopReason = 'error') {
  const stream = new AssistantMessageEventStream()
  const message = { role: 'assistant', content: [], api: 'host', provider: 'host', model: 'host', timestamp: Date.now(),
    usage: emptyUsage(), stopReason, ...(error ? { errorMessage: error.message, _hostFailure: error.failure } : {}) }
  if (error) stream.push({ type: 'error', reason: stopReason, error: message })
  else stream.push({ type: 'done', reason: stopReason, message })
  stream.end(message)
  return stream
}
/** Settle application-observed output directly as one Pi terminal message.
 * The observer has already admitted and recorded every chunk. No stream source,
 * provider dispatch or event re-publication is accepted at this boundary. */
export function observedPiMessage(request, observation) {
  const {finish,usage,replayState,stream,live}=observation
  const content=structuredClone(observation.content)
  const message={role:'assistant',api:'host',provider:request.provider,model:request.model,timestamp:Date.now(),_hostLive:live}
  if(finish.kind==='error'||finish.kind==='aborted')return{...message,content:[],usage:emptyUsage(),stopReason:finish.kind,errorMessage:finish.failure.message,_hostFailure:finish.failure}
  return {...message,
    content:content.map(block=>block.type==='tool-call'?{type:'toolCall',id:block.id,name:block.name,arguments:parseArgs(block.arguments)}:block.type==='reasoning'?{type:'thinking',thinking:block.text}:block),
    usage:usage?{...emptyUsage(),input:usage.inputTokens,output:usage.outputTokens,cacheRead:usage.cacheReadTokens??0,cacheWrite:usage.cacheWriteTokens??0,totalTokens:usage.totalTokens??usage.inputTokens+usage.outputTokens}:emptyUsage(),
    stopReason:finish.kind==='max-tokens'?'length':content.some(block=>block.type==='tool-call')?'toolUse':'stop',
    _hostMessage:createAssistantMessage({content,source:{provider:request.provider,model:request.model,...replayState===undefined?{}:{replayState}}}),
    _hostUsage:usage,_hostStream:stream,
  }
}
