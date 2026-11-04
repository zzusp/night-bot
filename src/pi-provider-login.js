import { builtinModels,builtinProviders,getBuiltinModels,getAllBuiltinModels } from '@earendil-works/pi-ai/providers/all'
export function piLoginMethods(provider) {
  const methods=[]
  // OpenAI's OAuth flow requires an installation device identity which this
  // application does not fabricate. Its API-key flow remains available.
  if(provider.id!=='openai'&&provider.auth.oauth)methods.push({id:'oauth',label:provider.auth.oauth.loginLabel??provider.auth.oauth.name})
  if(provider.auth.apiKey?.login)methods.push({id:'api-key',label:provider.auth.apiKey.name})
  return methods
}
export function piLoginNotice(event) {
  if(event.type==='device_code')return{message:'Enter this code on the verification page to finish signing in.',url:event.verificationUri,code:event.userCode}
  if(event.type==='auth_url')return{message:event.instructions??'Open this page to continue signing in.',url:event.url}
  if(event.type==='info')return{message:event.message,...event.links?.[0]?{url:event.links[0].url}:{}}
  if(event.type==='progress')return{message:event.message}
  return{message:'Signing in…'}
}
export function piLoginPrompt(prompt) {
  return{...(prompt.signal?{signal:prompt.signal}:{}),kind:prompt.type==='select'?'select':prompt.type==='secret'?'secret':'text',message:prompt.message,...prompt.type==='select'?{options:prompt.options}:prompt.placeholder===undefined?{}:{placeholder:prompt.placeholder}}
}
export function registerPiLoginFlows(ctx,authentication,{providers=builtinProviders(),makeModels=()=>builtinModels(authentication)}={}) {
  for(const provider of providers){
    if(!/^[a-z][a-z0-9-]*$/.test(provider.id))continue
    if(getBuiltinModels(provider.id).length===0&&getAllBuiltinModels(provider.id).length>0)continue
    const methods=piLoginMethods(provider);if(!methods.length)continue
    ctx.authorization.registerFlow({key:'llm-pi-ai/'+provider.id,label:provider.name,methods,
      async run(session){
        const models=makeModels();models.setProvider(provider)
        await models.login(provider.id,session.method==='oauth'?'oauth':'api_key',{signal:session.signal,notify:event=>session.notify(piLoginNotice(event)),prompt:prompt=>session.prompt(piLoginPrompt(prompt))})
      },
    })
  }
}
