import {Service} from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import {watch} from 'chokidar'
import {Document,isMap,isScalar,parseDocument} from 'yaml'
import {readFile,stat} from 'node:fs/promises'
import {join,resolve} from 'node:path'
import {isDeepStrictEqual} from 'node:util'
import {launchEnvironmentOf,resolveLegacyHome} from './native-environment.js'
import {canonicalizeWatchPath,withCredentialLock,writeCredentialFile} from './credential-file.js'
const fail=message=>{throw new TypeError('Credential document: '+message)}
const empty=()=>({refs:new Map(),records:new Map()})
const mapping=v=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&Object.getPrototypeOf(v)===Object.prototype
export function credentialRef(v){if(typeof v!=='string'||!/^[A-Za-z_][A-Za-z0-9_]*$/.test(v))fail('invalid reference name');return v}
export function credentialKey(v){if(typeof v!=='string'||!/^[a-z][a-z0-9-]*\/[a-z][a-z0-9-]*$/.test(v))fail('invalid record address');return v}
function nonempty(v){if(typeof v!=='string'||!v.length)fail('expected nonempty string');return v}
function json(v,seen=new Set()){
 if(v===null||typeof v==='boolean'||typeof v==='string'||typeof v==='number'&&Number.isFinite(v))return v
 if(!Array.isArray(v)&&!mapping(v)||seen.has(v))fail('payload must be acyclic JSON')
 seen.add(v);let copy;if(Array.isArray(v)){copy=[];for(let i=0;i<v.length;i++)copy.push(json(v[i],seen));if(Object.keys(v).some(k=>!/^\d+$/.test(k)||Number(k)>=v.length))fail('payload contains non-JSON array fields')}else{copy={};for(const [k,x] of Object.entries(v))Object.defineProperty(copy,k,{value:json(x,seen),enumerable:true,writable:true,configurable:true})}seen.delete(v);return copy
}
export function credentialRecord(v){
 if(!mapping(v))fail('record must be a mapping');const kind=v.kind,allowed=kind==='api-key'?['kind','key','env']:kind==='grant'?['kind','payload']:fail('unknown record kind')
 if(Object.keys(v).some(k=>!allowed.includes(k)))fail('unknown record field')
 if(kind==='grant'){if(!Object.hasOwn(v,'payload'))fail('grant payload missing');return{kind,payload:json(v.payload)}}
 const out={kind};if(v.key!==undefined)out.key=nonempty(v.key);if(v.env!==undefined){if(!mapping(v.env))fail('record environment must be a mapping');out.env={};for(const [k,x]of Object.entries(v.env))Object.defineProperty(out.env,credentialRef(k),{value:nonempty(x),enumerable:true,writable:true,configurable:true})}return out
}
function tree(text){const d=parseDocument(text,{prettyErrors:true,uniqueKeys:true});if(d.errors.length)fail('invalid YAML '+d.errors.map(e=>`${e.code} at ${e.linePos?.[0]?.line??'?'}:${e.linePos?.[0]?.col??'?'}`).join('; '));return d}
export function parseCredentialsDocument(text){
 const d=tree(text);let v;try{v=d.toJS({maxAliasCount:100})??{}}catch{fail('invalid YAML structure')}if(!mapping(v))fail('root must be a mapping');const result=empty();if(!Object.keys(v).length)return result
 if(v.version!==1||Object.keys(v).some(k=>!['version','refs','records'].includes(k)))fail('unsupported version or root fields')
 for(const section of ['refs','records']){const values=v[section]??{};if(!mapping(values))fail('section must be a mapping');for(const [k,x]of Object.entries(values))result[section].set(section==='refs'?credentialRef(k):credentialKey(k),section==='refs'?nonempty(x):credentialRecord(x))}return result
}
export function renderFlatLayoutMigration(text){let d;try{d=tree(text)}catch{return}if(!isMap(d.contents)||!d.contents.items.length||text.split('\n').some(l=>/^(%|---|\.\.\.)/.test(l)))return
 for(const p of d.contents.items){if(!isScalar(p.key)||!isScalar(p.value)||p.key.value==='version')return;try{credentialRef(p.key.value);nonempty(p.value.value)}catch{return}}
 return'version: 1\nrefs:\n'+text.split('\n').map(l=>l.length?'  '+l:l).join('\n')+(text.endsWith('\n')?'':'\n')
}
function render(text,section,key,value){const d=text===undefined?new Document({}):tree(text);d.set('version',1);if(value===undefined){const m=d.get(section,true);if(isMap(m)&&isScalar(m.items[0]?.key)&&m.items[0].key.value===key)m.commentBefore=null;d.deleteIn([section,key])}else d.setIn([section,key],value);const out=d.toString();parseCredentialsDocument(out);return out}
export default class NativeCredentials extends Service {
 static Config=z.object({path:z.string(),dshHome:z.string(),watch:z.boolean().default(true),debounceMs:z.number().min(0).default(100)})
 constructor(ctx,config={}){super(ctx,'credentials');this.host=ctx;this.spec={filename:resolve(config.path??join(resolveLegacyHome(config.dshHome),'.credentials.yaml')),watch:config.watch??true,debounceMs:config.debounceMs??100};this.snapshot=empty();this.text=undefined;this.operations=Promise.resolve();this.closed=false}
 async *[Service.init](){yield async()=>{this.closed=true;await this.operations};let text=await this.read();if(text!==undefined&&renderFlatLayoutMigration(text)!==undefined)text=await withCredentialLock(this.spec.filename,async owned=>{const current=await this.read();const migrated=current===undefined?undefined:renderFlatLayoutMigration(current);if(migrated===undefined)return current;await writeCredentialFile(this.spec.filename,migrated,owned);return migrated},{closed:()=>this.closed});this.accept(text,false)
  if(this.spec.watch){const watcher=watch(await canonicalizeWatchPath(this.spec.filename),{ignoreInitial:true,awaitWriteFinish:{stabilityThreshold:this.spec.debounceMs,pollInterval:Math.max(1,Math.min(this.spec.debounceMs,10))}});for(const event of ['all','ready'])watcher.on(event,()=>{if(!this.closed)this.queueRefresh()});watcher.on('error',()=>this.warn('watcher failed'));yield async()=>{this.closed=true;await watcher.close();await this.operations}}
 }
 warn(message){try{this.host.logger.warn('Native credentials: '+message)}catch{}}
 notify(event,key){try{for(const listener of this.host.events.dispatch('emit',[event,key]))try{Promise.resolve(listener(key)).catch(()=>this.warn('observer failed'))}catch{this.warn('observer failed')}}catch{this.warn('observer dispatch failed')}}
 async read(){try{const s=await stat(this.spec.filename);if(process.platform!=='win32'&&(s.mode&0o77))fail('file must be owner-only');return await readFile(this.spec.filename,'utf8')}catch(e){if(e.code!=='ENOENT')throw e;await canonicalizeWatchPath(this.spec.filename);return undefined}}
 accept(text,notify=true){const next=text===undefined?empty():parseCredentialsDocument(text),prev=this.snapshot;this.snapshot=next;this.text=text;if(notify)for(const section of ['refs','records'])for(const key of new Set([...prev[section].keys(),...next[section].keys()]))if(!isDeepStrictEqual(prev[section].get(key),next[section].get(key)))this.notify('credentials/'+(section==='refs'?'reference':'record')+'-updated',key)}
 enqueue(fn){const p=this.operations.then(fn);this.operations=p.then(()=>{},()=>{});return p}
 queueRefresh(){return this.enqueue(async()=>{if(this.closed)return;try{const text=await this.read();if(!this.closed&&text!==this.text)this.accept(text)}catch{this.warn('reload failed; keeping last good snapshot')}})}
 inherited(ref){const e=launchEnvironmentOf(this.host).getFrom(ref,['process']);return e?.value.length?e.value:undefined}
 fallback(ref){const e=launchEnvironmentOf(this.host).getFrom(ref,['project-env','user-env']);return e?.value.length?e:undefined}
 async resolve(ref){credentialRef(ref);const v=this.inherited(ref);if(v!==undefined)return{value:v,source:'env'};if(this.snapshot.refs.has(ref))return{value:this.snapshot.refs.get(ref),source:'file'};const e=this.fallback(ref);if(e)return{value:e.value,source:e.source}}
 async describe(ref){const e=await this.resolve(ref);return e?{configured:true,source:e.source,writable:e.source!=='env'}:{configured:false,writable:true}}
 assertWritable(ref){credentialRef(ref);if(this.inherited(ref)!==undefined)throw new Error('Credential reference is read-only in launching environment')}
 async set(ref,value){this.assertWritable(ref);nonempty(value);return this.edit('refs',ref,()=>value)}
 async unset(ref){this.assertWritable(ref);return this.edit('refs',ref,()=>undefined)}
 async readRecord(key){credentialKey(key);return structuredClone(this.snapshot.records.get(key))}
 async describeRecord(key){const r=await this.readRecord(key);return r?{configured:true,kind:r.kind,writable:true}:{configured:false,writable:true}}
 async listRecords(){return[...this.snapshot.records].map(([key,r])=>({key,kind:r.kind}))}
 async modifyRecord(key,mutate,options){credentialKey(key);if(typeof mutate!=='function')throw new TypeError('Credential mutator required');return this.edit('records',key,mutate,true,options)}
 async deleteRecord(key,options){credentialKey(key);return this.edit('records',key,()=>undefined,false,options)}
 edit(section,key,mutate,keepUndefined=false,{signal}={}){signal?.throwIfAborted();if(this.closed)return Promise.reject(new Error('Credential store disposed'));return this.enqueue(async()=>{signal?.throwIfAborted();if(this.closed)throw new Error('Credential store disposed');return withCredentialLock(this.spec.filename,async owned=>{if(section==='refs')this.assertWritable(key);this.accept(await this.read());const before=structuredClone(this.snapshot[section].get(key));signal?.throwIfAborted();if(this.closed)throw new Error('Credential store closed before mutation');let next=await mutate(before);if(keepUndefined&&next===undefined)return structuredClone(this.snapshot[section].get(key));if(next!==undefined)next=section==='records'?credentialRecord(next):nonempty(next);if(next===undefined&&!this.snapshot[section].has(key))return;const text=render(this.text,section,key,next);const unchanged=isDeepStrictEqual(next,this.snapshot[section].get(key));await writeCredentialFile(this.spec.filename,text,owned);this.accept(text);if(unchanged)this.notify('credentials/'+(section==='refs'?'reference':'record')+'-updated',key);return structuredClone(next)},{closed:()=>{signal?.throwIfAborted();return this.closed}})})}
}
