import {join} from 'node:path'
import {memoryHost} from './memory-host.js'
import {nativeTestTimeout} from './native-lifecycle.js'
import {openResidentStore} from '../../packages/dingtalk-core/store.js'
import {openDynamicTaskStore} from '../../packages/dingtalk-core/dynamic-task-store.js'
import {openTaskSessionService} from '../../packages/dingtalk-core/task-session-service.js'

export const requestText = body => body.messages.flatMap(message => typeof message.content === 'string'
  ? [message.content] : (message.content ?? []).filter(part => part.type === 'text').map(part => part.text))
export const requestTools = body => body.tools?.map(tool => tool.function.name) ?? []
export function requestEnvelope(body, prefix) {
  for (const text of requestText(body).toReversed()) {
    const line = text.split('\n').find(value => value.startsWith(prefix))
    if (line) return JSON.parse(line.slice(prefix.length))
  }
}
export const channelMessage = (id, extra = {}) => ({type:'chat-room',channelId:'resident-fixture',
  conversationId:'shared-room',senderId:'alice',messageId:String(id),text:'Original request '+id,...extra})

export async function eventually(read, description, signal) {
  const timeout = AbortSignal.timeout(nativeTestTimeout(15000))
  const stop = signal ? AbortSignal.any([signal, timeout]) : timeout
  for (;;) {
    if (stop.aborted) throw new Error('Timed out: '+description, {cause:stop.reason})
    const result = await read()
    if (result) return result
    await new Promise(resolve => setTimeout(resolve, 10))
  }
}

// Uses the real Host, official Pi factory, HTTP model endpoint and channel
// transport. Only the model response and external send/readback are scripted.
export async function residentRouterHost(t, decide, options = {}) {
  let opened, closed = false
  t.after(close)
  const f = await memoryHost(t, decide, options.hostOptions), sent = [], readbacks = [], results = []
  const config = {...f.config.model, workspaceDir:f.host.ctx.runtimePaths.workspaces,
    dbPath:join(f.host.ctx.runtimePaths.state, 'tasks.sqlite'),instanceId:'resident-router-fixture',
    initialize:true,ownerActorId:'owner',webActorId:'owner',agentPreset:'night-bot',reasoningMode:'inherit',
    ...options.config}
  async function open() {
    const ctx = f.host.ctx, residentStore = await openResidentStore(ctx.storageDomain)
    const rawStore = await openDynamicTaskStore({...config,initialize:config.initialize})
    const store = options.wrapStore ? options.wrapStore(rawStore) : rawStore
    const service = await openTaskSessionService({ctx,config,store,residentStore,
      legacy:{getAgentConfig:()=>({...config,agentNames:['assistant']}),getGroup:id=>residentStore.getGroup(id)},
      notifications:{send:async()=>{throw Error('Channel replies must use registered transport')},
        readback:async()=>{throw Error('Channel replies must use registered transport')}}})
    opened = {service,store,residentStore}
    ctx.on('tools/result',(execution,result)=>results.push({name:execution.name,sessionId:execution.agent?.id,result}))
    ctx.channels.registerTransport('resident-fixture', {
      async send(envelope) {
        sent.push(structuredClone(envelope))
        return options.send ? options.send(envelope) : {messageId:'visible-'+sent.length}
      },
      async readback(envelope) {
        readbacks.push(structuredClone(envelope))
        return options.readback ? options.readback(envelope) : {messageId:'visible-'+sent.length,visible:true}
      },
    })
    closed = false
  }
  async function close() {
    if (closed) return
    closed = true
    try { await opened?.service.close() }
    catch(error){const detail=value=>({message:value?.message,code:value?.code,stack:value?.stack,errors:value?.errors?.map(detail)});t.diagnostic(JSON.stringify({routerHostClose:detail(error)}));throw error}
    finally { try { await opened?.store.close() } finally { await opened?.residentStore.close() } }
  }
  await open()
  return {...f,get host(){return f.host},get service(){return opened.service},get store(){return opened.store},
    get residentStore(){return opened.residentStore},sent,readbacks,results,close,
    receive:input=>f.host.ctx.channels.receive(input),
    query:(kind,args={})=>opened.store.query({kind,...args}),
    async restart(){await close();await f.close();await f.boot();await open();await opened.service.recover()},
  }
}
