import {Service} from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import {z as schema} from 'zod'
import {isAbsolute} from 'node:path'
import { createUserMessage } from './native-message-protocol.js';
/** Session-local directory state. Filesystem resolution remains behind the
 * existing filesystem capability; changing cwd never changes a sandbox grant. */
export default class NativeWorkingDirectory extends Service {
 static inject=['fs','sessionProjections','systemPrompt']
 static Config=z.object({defaultDirectory:z.string()})
 constructor(ctx,config={}){
  super(ctx,'workingDirectory');this.host=ctx;this.defaultDirectory=config.defaultDirectory??process.cwd();if(typeof this.defaultDirectory!=='string'||!isAbsolute(this.defaultDirectory))throw new TypeError('working-directory: defaultDirectory must be absolute')
  this.tails=new WeakMap();this.operations=new Set();this.lifecycle=new AbortController();const directory=schema.string().min(1).refine(isAbsolute).nullable()
  ctx.sessionProjections.register({key:'workingDirectory',stateVersion:1,stateSchema:directory,init:header=>header.cwd??null,apply:(state,event)=>event.type==='working-directory/change'?event.data.cwd:state,wire:{viewSchema:directory,view:state=>state}})
  ctx.systemPrompt.context({name:'working-directory:current',order:ctx.systemPrompt.getContextOrder('WORKING_DIRECTORY'),required:true,interpolate:false,text:context=>context.agent?this.contextText(context.agent.session):''})
  ctx.on('system-prompt/assemble',async(_assembly,context,next)=>{if(!context.agent)return next();await this.ensure(context.agent,context.signal);const assembly=await next();this.lifecycle.signal.throwIfAborted();const text=this.contextText(context.agent.session),row=assembly.contexts.find(c=>c.name==='working-directory:current');if(row){row.text=text;row.interpolate=false}else assembly.contexts.unshift({name:'working-directory:current',text,interpolate:false});return assembly},{prepend:true})
  ctx.effect(()=>async()=>{this.lifecycle.abort(new Error('working-directory service disposed'));await Promise.allSettled([...this.operations])},'native directory teardown')
 }
 get(session){return this.ctx.sessionProjections.stateOf(session,'workingDirectory')??this.defaultDirectory}
 contextText(session){return`Current working directory: ${JSON.stringify(this.get(session))}.`}
 serialize(agent,signal,action){const control=signal?AbortSignal.any([signal,this.lifecycle.signal]):this.lifecycle.signal,session=agent.session;const task=(this.tails.get(session)??Promise.resolve()).then(()=>{control.throwIfAborted();agent.ctx.fiber.assertActive();return action(control)}).finally(()=>this.operations.delete(task));this.operations.add(task);this.tails.set(session,task.then(()=>{},()=>{}));return task}
 async directory(path,cwd,signal){const target=await this.ctx.fs.resolve(path,{cwd,signal}),info=await this.ctx.fs.stat(target,signal);signal.throwIfAborted();if(info?.type!=='directory')throw new Error(`working-directory: directory does not exist: ${JSON.stringify(path)}`);const resolved=this.ctx.fs.processPath(target);if(typeof resolved!=='string'||!isAbsolute(resolved))throw new Error('working-directory: filesystem returned a non-absolute process path');return resolved}
 ensure(agent,signal){return this.serialize(agent,signal,async control=>{const current=this.get(agent.session),target=await this.ctx.fs.resolve(current,{signal:control}),info=await this.ctx.fs.stat(target,control);control.throwIfAborted();agent.ctx.fiber.assertActive();if(info?.type==='directory'){if(this.ctx.sessionProjections.stateOf(agent.session,'workingDirectory')===null)agent.session.append('working-directory/change',{cwd:current});return current}const original=agent.session.header.cwd??this.defaultDirectory,restored=await this.directory(original,original,control);this.commit(agent,restored,true,control);return restored})}
 set(agent,path,signal){return this.serialize(agent,signal,async control=>{if(typeof path!=='string'||!path.length)throw new Error('working-directory: cd must not be empty');const directory=await this.directory(path,this.get(agent.session),control);this.commit(agent,directory,false,control);return directory})}
 commit(agent,directory,recovered,signal){signal.throwIfAborted();agent.ctx.fiber.assertActive();const previous=this.get(agent.session);if(previous===directory)return;agent.session.append('working-directory/change',{cwd:directory});const notice=createUserMessage({source:{kind:'working-directory'},content:[{type:'text',text:recovered?`The working directory ${JSON.stringify(previous)} is unavailable. The working directory is now ${JSON.stringify(directory)}.`:`The working directory changed from ${JSON.stringify(previous)} to ${JSON.stringify(directory)}.`}]});try{Promise.resolve(agent.inject(notice)).catch(()=>this.warn())}catch{this.warn()}}
 warn(){try{this.ctx.logger.warn('working-directory: committed directory, but could not queue its notice')}catch{}}
}
