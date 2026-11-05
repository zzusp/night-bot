import {Service} from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import {z as schema} from 'zod'
import {isAbsolute} from 'node:path'
import { createUserMessage } from './native-message-protocol.js';
const actorDirectories=new WeakMap()
const unbound=()=>Object.assign(new Error('Official working directory actor is not bound'),{code:'PI_WORKING_DIRECTORY_ACTOR_UNBOUND'})
export function bindWorkingDirectoryActor(actor,port){
 if(!actor||!port||typeof port.initialDirectory!=='string'||!isAbsolute(port.initialDirectory))throw new TypeError('Absolute initial directory required')
 const prior=actorDirectories.get(actor);if(prior){if(prior.source!==port)throw new Error('Working directory actor already bound');return()=>{}}
 const bound={source:port,initialDirectory:port.initialDirectory}
 for(const name of ['readDirectory','appendChange','admitNotice','isLive']){if(typeof port[name]!=='function')throw new TypeError('Working directory port requires '+name);bound[name]=port[name].bind(port)}
 Object.freeze(bound);actorDirectories.set(actor,bound)
 return()=>{if(actorDirectories.get(actor)===bound)actorDirectories.delete(actor)}
}
function officialDirectory(actor){const port=actorDirectories.get(actor);if(!port||!port.isLive(actor))throw unbound();return port}
/** Session-local directory state. Filesystem resolution remains behind the
 * existing filesystem capability; changing cwd never changes a sandbox grant. */
export default class NativeWorkingDirectory extends Service {
 static inject=['fs','sessionProjections','systemPrompt']
 static Config=z.object({defaultDirectory:z.string()})
 constructor(ctx,config={}){
  super(ctx,'workingDirectory');this.host=ctx;this.defaultDirectory=config.defaultDirectory??process.cwd();if(typeof this.defaultDirectory!=='string'||!isAbsolute(this.defaultDirectory))throw new TypeError('working-directory: defaultDirectory must be absolute')
  this.tails=new WeakMap();this.operations=new Set();this.lifecycle=new AbortController();const directory=schema.string().min(1).refine(isAbsolute).nullable()
  ctx.sessionProjections.register({key:'workingDirectory',stateVersion:1,stateSchema:directory,init:header=>header.cwd??null,apply:(state,event)=>event.type==='working-directory/change'?event.data.cwd:state,wire:{viewSchema:directory,view:state=>state}})
  ctx.systemPrompt.context({name:'working-directory:current',order:ctx.systemPrompt.getContextOrder('WORKING_DIRECTORY'),required:true,interpolate:false,officialText:async({actor})=>{await this.ensure(actor);return this.contextText(actor)},text:context=>context.agent?this.contextText(context.agent.session):''})
  ctx.on('system-prompt/assemble',async(_assembly,context,next)=>{if(!context.agent)return next();await this.ensure(context.agent,context.signal);const assembly=await next();this.lifecycle.signal.throwIfAborted();const text=this.contextText(context.agent.session),row=assembly.contexts.find(c=>c.name==='working-directory:current');if(row){row.text=text;row.interpolate=false}else assembly.contexts.unshift({name:'working-directory:current',text,interpolate:false});return assembly},{prepend:true})
  ctx.effect(()=>async()=>{this.lifecycle.abort(new Error('working-directory service disposed'));await Promise.allSettled([...this.operations])},'native directory teardown')
 }
 get(session){if(actorDirectories.has(session)||session?.piSession){const port=officialDirectory(session),value=port.readDirectory();if(value!==null&&(typeof value!=='string'||!isAbsolute(value)))throw new Error('Invalid official directory snapshot');return value??port.initialDirectory}return this.ctx.sessionProjections.stateOf(session,'workingDirectory')??this.defaultDirectory}
 contextText(session){return`Current working directory: ${JSON.stringify(this.get(session))}.`}
 serialize(agent,signal,action){const control=signal?AbortSignal.any([signal,this.lifecycle.signal]):this.lifecycle.signal,session=agent.piSession?(officialDirectory(agent),agent):agent.session;const task=(this.tails.get(session)??Promise.resolve()).then(()=>{control.throwIfAborted();if(agent.piSession)officialDirectory(agent);else agent.ctx.fiber.assertActive();return action(control)}).finally(()=>this.operations.delete(task));this.operations.add(task);this.tails.set(session,task.then(()=>{},()=>{}));return task}
 async directory(path,cwd,signal){const target=await this.ctx.fs.resolve(path,{cwd,signal}),info=await this.ctx.fs.stat(target,signal);signal.throwIfAborted();if(info?.type!=='directory')throw new Error(`working-directory: directory does not exist: ${JSON.stringify(path)}`);const resolved=this.ctx.fs.processPath(target);if(typeof resolved!=='string'||!isAbsolute(resolved))throw new Error('working-directory: filesystem returned a non-absolute process path');return resolved}
 ensure(agent,signal){return this.serialize(agent,signal,async control=>{const port=agent.piSession?officialDirectory(agent):undefined,current=this.get(port?agent:agent.session),target=await this.ctx.fs.resolve(current,{signal:control}),info=await this.ctx.fs.stat(target,control);control.throwIfAborted();if(port)officialDirectory(agent);else agent.ctx.fiber.assertActive();if(info?.type==='directory'){if(port){if(port.readDirectory()===null)await port.appendChange({cwd:current,recovered:false})}else if(this.ctx.sessionProjections.stateOf(agent.session,'workingDirectory')===null)agent.session.append('working-directory/change',{cwd:current});return current}const original=port?.initialDirectory??agent.session.header.cwd??this.defaultDirectory,restored=await this.directory(original,original,control);await this.commit(agent,restored,true,control);return restored})}
 set(agent,path,signal){return this.serialize(agent,signal,async control=>{if(typeof path!=='string'||!path.length)throw new Error('working-directory: cd must not be empty');const directory=await this.directory(path,this.get(agent.piSession?agent:agent.session),control);await this.commit(agent,directory,false,control);return directory})}
 async commit(agent,directory,recovered,signal){signal.throwIfAborted();if(agent.piSession){const port=officialDirectory(agent),previous=this.get(agent);if(previous===directory)return;await port.appendChange({cwd:directory,recovered});await port.admitNotice({previous,cwd:directory,recovered});return}agent.ctx.fiber.assertActive();const previous=this.get(agent.session);if(previous===directory)return;agent.session.append('working-directory/change',{cwd:directory});const notice=createUserMessage({source:{kind:'working-directory'},content:[{type:'text',text:recovered?`The working directory ${JSON.stringify(previous)} is unavailable. The working directory is now ${JSON.stringify(directory)}.`:`The working directory changed from ${JSON.stringify(previous)} to ${JSON.stringify(directory)}.`}]});try{Promise.resolve(agent.inject(notice)).catch(()=>this.warn())}catch{this.warn()}}
 warn(){try{this.ctx.logger.warn('working-directory: committed directory, but could not queue its notice')}catch{}}
}
