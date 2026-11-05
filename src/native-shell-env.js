import {isPromise} from 'node:util/types'
import {Service} from '@deepseek-ai/cordis'
import schema from '@deepseek-ai/schemastery'
export const PREFIX='NIGHT_BOT_'
const reserved=new Set(['NIGHT_BOT_SHELL','NIGHT_BOT_SESSION_ID'])
const valid=key=>key.startsWith(PREFIX)&&/^[A-Z][A-Z0-9_]*$/.test(key.slice(PREFIX.length))
/** Trusted execution metadata only. No global home or plugin-profile ABI is
 * exported to model processes; ambient values never own execution identity. */
export default class NativeShellEnvironment extends Service {
 static Config=schema.object({})
 constructor(ctx,config={}){super(ctx,'shellEnv');this.contributors=new Map();this.owners=new Map();this.closed=false;if(Object.keys(config).length)throw new Error('Shell facts do not accept home/profile configuration');ctx.effect(()=>()=>{this.closed=true;this.contributors.clear();this.owners.clear()},'native shell environment teardown')}
 assertOpen(){if(this.closed)throw new Error('Shell environment registry disposed')}
 register(contributor){
  this.assertOpen();const name=contributor.name
  if(typeof name!=='string'||!name.trim()||typeof contributor.resolve!=='function')throw new TypeError('Shell environment contributor requires a name and resolver')
  const declarations=new Map()
  for(const [key,value]of Object.entries(contributor.variables)){if(!valid(key))throw new Error('Invalid shell environment key '+key);if(reserved.has(key))throw new Error('Reserved shell environment key '+key);const description=value?.description;if(typeof description!=='string'||!description.trim())throw new Error('Shell environment key needs a description: '+key);declarations.set(key,description)}
  const record={name,declarations,source:contributor}
  const dispose=this.ctx.effect(()=>{this.assertOpen();if(this.contributors.has(name))throw new Error('Duplicate shell environment contributor '+name);for(const key of declarations.keys())if(this.owners.has(key))throw new Error('Shell environment key already owned: '+key);this.contributors.set(name,record);for(const key of declarations.keys())this.owners.set(key,record);return()=>{if(this.contributors.get(name)===record)this.contributors.delete(name);for(const key of declarations.keys())if(this.owners.get(key)===record)this.owners.delete(key)}},'native shell environment registration')
  return()=>void dispose()
 }
 collect(execution){
  this.assertOpen();const values={NIGHT_BOT_SHELL:'1'}
  if(execution.agent!==undefined)values.NIGHT_BOT_SESSION_ID=execution.agent.session.header.id
  for(const record of [...this.contributors.values()].sort((a,b)=>a.name.localeCompare(b.name))){const resolver=record.source.resolve;if(typeof resolver!=='function')throw new Error('Shell environment resolver unavailable');const resolved=Reflect.apply(resolver,record.source,[execution]);if(isPromise(resolved)){void Promise.prototype.then.call(resolved,()=>{},()=>{});throw new Error('Shell environment resolver must return a synchronous record')}if(!resolved||typeof resolved!=='object'||typeof resolved.then==='function')throw new Error('Shell environment resolver must return a synchronous record');for(const [key,value]of Object.entries(resolved)){if(!record.declarations.has(key))throw new Error('Undeclared shell environment key '+key);if(typeof value!=='string')throw new Error('Non-string shell environment value for '+key);values[key]=value}}
  this.assertOpen();return Object.freeze(Object.fromEntries(Object.entries(values).sort(([a],[b])=>a.localeCompare(b))))
 }
 list(){this.assertOpen();return[...this.contributors.values()].flatMap(r=>[...r.declarations].map(([key,description])=>({contributor:r.name,key,description}))).sort((a,b)=>a.key.localeCompare(b.key))}
}
