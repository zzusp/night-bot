import {Service} from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import {isAbsolute} from 'node:path'
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
export function officialWorkingDirectoryOrigin(actor){return officialDirectory(actor).initialDirectory}
function officialDirectory(actor){const port=actorDirectories.get(actor);if(!port||!port.isLive(actor))throw unbound();return port}
/** Session-local directory state. Filesystem resolution remains behind the
 * existing filesystem capability; changing cwd never changes a sandbox grant. */
export default class NativeWorkingDirectory extends Service {
 static inject=['fs','systemPrompt']
 static Config=z.object({defaultDirectory:z.string()})
 constructor(ctx,config={}){
  super(ctx,'workingDirectory');this.host=ctx;this.defaultDirectory=config.defaultDirectory??process.cwd();if(typeof this.defaultDirectory!=='string'||!isAbsolute(this.defaultDirectory))throw new TypeError('working-directory: defaultDirectory must be absolute')
  this.tails=new WeakMap();this.operations=new Set();this.lifecycle=new AbortController()
  ctx.systemPrompt.context({name:'working-directory:current',order:ctx.systemPrompt.getContextOrder('WORKING_DIRECTORY'),required:true,interpolate:false,officialText:async({actor})=>{await this.ensure(actor);return this.contextText(actor)},text:context=>context.agent?this.contextText(context.agent):''})
  ctx.effect(()=>async()=>{this.lifecycle.abort(new Error('working-directory service disposed'));await Promise.allSettled([...this.operations])},'native directory teardown')
 }
 get(actor){const port=officialDirectory(actor),value=port.readDirectory();if(value!==null&&(typeof value!=='string'||!isAbsolute(value)))throw new Error('Invalid official directory snapshot');return value??port.initialDirectory}
 contextText(actor){return`Current working directory: ${JSON.stringify(this.get(actor))}.`}
 serialize(actor,signal,action){const control=signal?AbortSignal.any([signal,this.lifecycle.signal]):this.lifecycle.signal;officialDirectory(actor);const task=(this.tails.get(actor)??Promise.resolve()).then(()=>{control.throwIfAborted();officialDirectory(actor);return action(control)}).finally(()=>this.operations.delete(task));this.operations.add(task);this.tails.set(actor,task.then(()=>{},()=>{}));return task}
 async directory(path,cwd,signal){const target=await this.ctx.fs.resolve(path,{cwd,signal}),info=await this.ctx.fs.stat(target,signal);signal.throwIfAborted();if(info?.type!=='directory')throw new Error(`working-directory: directory does not exist: ${JSON.stringify(path)}`);const resolved=this.ctx.fs.processPath(target);if(typeof resolved!=='string'||!isAbsolute(resolved))throw new Error('working-directory: filesystem returned a non-absolute process path');return resolved}
 ensure(actor,signal){return this.serialize(actor,signal,async control=>{const port=officialDirectory(actor),current=this.get(actor),fs=this.ctx.fs,info=typeof fs.statWorkingDirectory==='function'?await fs.statWorkingDirectory(actor,current,control):await fs.stat(await fs.resolve(current,{signal:control}),control);control.throwIfAborted();officialDirectory(actor);if(info?.type==='directory'){if(port.readDirectory()===null)await port.appendChange({cwd:current,recovered:false});return current}const restored=await this.directory(port.initialDirectory,port.initialDirectory,control);await this.commit(actor,restored,true,control);return restored})}
 set(actor,path,signal){return this.serialize(actor,signal,async control=>{if(typeof path!=='string'||!path.length)throw new Error('working-directory: cd must not be empty');const directory=await this.directory(path,this.get(actor),control);await this.commit(actor,directory,false,control);return directory})}
 async commit(actor,directory,recovered,signal){signal.throwIfAborted();const port=officialDirectory(actor),previous=this.get(actor);if(previous===directory)return;await port.appendChange({cwd:directory,recovered});await port.admitNotice({previous,cwd:directory,recovered})}
}
