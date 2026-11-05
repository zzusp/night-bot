import {Context} from '@deepseek-ai/cordis'
import {join,dirname} from 'node:path'
import NativeCredentials from './native-credentials.js'
import NativeAuthorization from './native-authorization.js'
import {piAuthentication} from './pi-provider-auth.js'
import {registerPiLoginFlows} from './pi-provider-login.js'
import {runtimePaths,prepareSecrets} from './runtime/paths.js'
import {privateDirectory} from './runtime/files.js'

export class OperatorAuthError extends Error {
 constructor(code){super(code);this.code=code}
}
const invalid=()=>{throw new OperatorAuthError('NIGHT_BOT_AUTH_COMMAND_INVALID')}
const providerKey=id=>{if(typeof id!=='string'||! /^[a-z][a-z0-9-]*$/.test(id))invalid();return 'llm-pi-ai/'+id}
const reference=name=>{if(typeof name!=='string'||! /^[A-Za-z_][A-Za-z0-9_]*$/.test(name))invalid();return name}
/** A separate operator process. Never compose resident services, connect DWS,
 * create agents or open business/task ledgers just to manage credentials. */
export async function runAuthCommand(config,args,{environmentSnapshot,interaction,signal,registerFlows=registerPiLoginFlows}={}){
 const [command,target,method,...extra]=args
 if(extra.length||!['list','login','logout','describe-ref','set-ref','unset-ref'].includes(command))invalid()
 if(command==='list'&&(target!==undefined||method!==undefined)||command!=='login'&&method!==undefined||command!=='list'&&target===undefined)invalid()
 if(command.endsWith('-ref'))reference(target);else if(target!==undefined)providerKey(target)
 const ctx=new Context()
 try{
  const paths=runtimePaths(config);await prepareSecrets(paths)
  await privateDirectory(dirname(paths.credentials))
  ctx.provide('launchEnvironment',environmentSnapshot)
  await ctx.plugin(NativeCredentials,{path:paths.credentials,watch:false})
  await ctx.plugin(NativeAuthorization)
  const authentication=piAuthentication({getCredentials:()=>ctx.credentials,getEnvironment:name=>environmentSnapshot.get(name)?.value})
  registerFlows(ctx,authentication)
  signal?.throwIfAborted()
  if(command==='list')return {flows:await Promise.all(ctx.authorization.list().map(async flow=>({...flow,credential:await ctx.credentials.describeRecord(flow.key)}))),references:await Promise.all([...new Set(Object.values(config.providers).map(p=>p.apiKeyEnv).filter(v=>v!==undefined))].map(async name=>({name,...await ctx.credentials.describe(reference(name))})))}
  if(command==='describe-ref')return {reference:target,...await ctx.credentials.describe(target)}
  if(command==='unset-ref'){await ctx.credentials.unset(target,{signal});return {reference:target,...await ctx.credentials.describe(target)}}
  if(command==='set-ref'){
   if(!(await ctx.credentials.describe(target)).writable)throw new OperatorAuthError('NIGHT_BOT_AUTH_REFERENCE_READ_ONLY')
   const value=await interaction.prompt({kind:'secret',message:'Credential value',signal})
   signal?.throwIfAborted();await ctx.credentials.set(target,value,{signal})
   return {reference:target,...await ctx.credentials.describe(target)}
  }
  if(command==='logout'){await ctx.credentials.deleteRecord(providerKey(target),{signal});return {provider:target,...await ctx.credentials.describeRecord(providerKey(target))}}
  const result=await ctx.authorization.begin({key:providerKey(target),method,interaction,signal})
  return {provider:target,...result}
 }finally{await ctx.fiber.dispose()}
}
