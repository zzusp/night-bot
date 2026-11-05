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
/** Preserve the existing wire adapter's multimodal, credentials and retry contract.
 * Pi owns iteration and tool dispatch; this bridge translates stream protocols only.
 */
export function bridgeDshStream(source, request, live) {
  const stream = new AssistantMessageEventStream()
  void (async () => {
    try {
      live.start()
      for await (const chunk of source) { request.signal?.throwIfAborted(); live.push(chunk) }
      const finish = live.finish
      if (finish.kind === 'error' || finish.kind === 'aborted') {
        const message = { role: 'assistant', content: [], api: 'host', provider: request.provider, model: request.model,
          timestamp: Date.now(), usage: emptyUsage(), stopReason: finish.kind, errorMessage: finish.failure.message,
          _hostFailure: finish.failure, _hostLive: live }
        stream.push({ type: 'error', reason: finish.kind, error: message }); stream.end(message); return
      }
      const content = live.blocks()
      const usage = live.usage
      const message = { role: 'assistant', content: content.map(block => block.type === 'tool-call'
        ? { type: 'toolCall', id: block.id, name: block.name, arguments: parseArgs(block.arguments) }
        : block.type === 'reasoning' ? { type: 'thinking', thinking: block.text } : block),
        provider: request.provider, model: request.model, api: 'host', timestamp: Date.now(),
        usage: usage ? { ...emptyUsage(), input: usage.inputTokens, output: usage.outputTokens,
          cacheRead: usage.cacheReadTokens ?? 0, cacheWrite: usage.cacheWriteTokens ?? 0,
          totalTokens: usage.totalTokens ?? usage.inputTokens + usage.outputTokens } : emptyUsage(),
        stopReason: finish.kind === 'max-tokens' ? 'length' : content.some(b => b.type === 'tool-call') ? 'toolUse' : 'stop',
        _hostMessage: createAssistantMessage({ content, source: { provider: request.provider, model: request.model,
          ...(live.replayState === undefined ? {} : { replayState: live.replayState }) } }),
        _hostUsage: usage, _hostStream: live.stream, _hostLive: live }
      stream.push({ type: 'done', reason: message.stopReason, message }); stream.end(message)
    } catch (error) {
      const failed = piFailureStream(error, request.signal?.aborted ? 'aborted' : 'error')
      for await (const event of failed) stream.push(event)
      stream.end(await failed.result())
    }
  })()
  return stream
}
