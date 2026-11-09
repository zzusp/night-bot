import { getBuiltinModels } from '@earendil-works/pi-ai/providers/all'
import { attributionHeaders, LlmError } from './native-llm-protocol.js'
const fail=(message,code='DISCOVERY_FAILED',cause)=>{throw new LlmError(message,code,cause?{cause}:undefined)}
const capacity=(...values)=>values.find(value=>Number.isSafeInteger(value)&&value>0)
const label=(...values)=>values.find(value=>typeof value==='string'&&value.length>0)
export async function discoverPiModels(request,storedProfile) {
  const installed=request.provider?getBuiltinModels(request.provider):[]
  if(installed.length)return installed.map(m=>({id:m.id,name:m.name,contextWindow:m.contextWindow,maxTokens:m.maxTokens,inputModalities:[...m.input]}))
  const api=request.api??'openai-completions'
  if(!['openai-completions','openai-responses','anthropic-messages'].includes(api))fail('Protocol does not expose a supported model listing','DISCOVERY_UNSUPPORTED')
  if(typeof request.baseURL!=='string'||!request.baseURL)fail('A model listing requires a baseURL')
  const base=request.baseURL.replace(/\/+$/,''),url=api==='anthropic-messages'?(base.endsWith('/v1')?base.slice(0,-3):base)+'/v1/models?limit=1000':base+'/models'
  const stored=storedProfile?.(),supplied=request.apiKey??await stored?.resolveApiKey()
  let key
  if(supplied!==undefined){key=supplied.trim();if(!/^[\x21-\x7E]+$/.test(key))fail('Invalid provider API key','INVALID_CREDENTIAL')}
  const headers=new Headers(stored?.headers);headers.set('accept','application/json')
  if(api==='anthropic-messages'){headers.set('anthropic-version','2023-06-01');if(key!==undefined)headers.set('x-api-key',key)}else if(key!==undefined)headers.set('authorization','Bearer '+key)
  for(const [name,value]of Object.entries(attributionHeaders()))headers.set(name,value)
  let response
  try{response=await fetch(url,{headers,signal:request.signal})}catch(error){fail('Model discovery request failed',request.signal?.aborted?'ABORTED':'DISCOVERY_FAILED',error)}
  if(!response.ok){await response.body?.cancel();fail('Model listing answered HTTP '+response.status)}
  const limit=4*1024*1024,declared=Number(response.headers.get('content-length'))
  if(declared>limit){await response.body?.cancel();fail('Model listing exceeds byte limit')}
  const reader=response.body?.getReader(),chunks=[];let length=0
  try{if(reader)while(true){const item=await reader.read();if(item.done)break;length+=item.value.byteLength;if(length>limit)fail('Model listing exceeds byte limit');chunks.push(item.value)}}catch(error){if(request.signal?.aborted)fail('Model discovery aborted','ABORTED',error);throw error}finally{await reader?.cancel().catch(()=>{})}
  let body
  try{body=JSON.parse(Buffer.concat(chunks).toString('utf8'))}catch(error){fail('Model listing is not JSON','DISCOVERY_FAILED',error)}
  let entries
  if(Array.isArray(body?.data))entries=body.data.map(raw=>({raw}))
  else if(body?.models&&typeof body.models==='object'&&!Array.isArray(body.models))entries=Object.entries(body.models).map(([key,raw])=>({key,raw}))
  else fail('Reply contains no supported model listing')
  return entries.flatMap(({key,raw})=>{
    const id=label(key,raw?.id);if(!id)return[]
    const name=label(raw?.name,raw?.display_name,raw?.displayName)??id,contextWindow=capacity(raw?.contextWindow,raw?.context_window,raw?.context_length,raw?.max_input_tokens,raw?.limit?.context),maxTokens=capacity(raw?.maxOutputTokens,raw?.max_output_tokens,raw?.maxTokens,raw?.max_tokens,raw?.limit?.output,raw?.top_provider?.max_completion_tokens)
    return[{id,name,...contextWindow===undefined?{}:{contextWindow},...maxTokens===undefined?{}:{maxTokens}}]
  })
}
