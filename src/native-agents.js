import {Service,getTraceable,symbols} from '@deepseek-ai/cordis'
import {AsyncLocalStorage} from 'node:async_hooks'
import {isPromise} from 'node:util/types'
import {scopeTarget} from '@deepseek-ai/dsh-scope'
/** Live Pi-agent ownership and causal attribution. Attribution never grants
 * authority; callers must validate identity and resolve the exact live agent. */
export default class NativeAgents extends Service{
 constructor(ctx){
  super(ctx,'agents');this.entries=new Map();this.initiators=new AsyncLocalStorage();this.runs=new AsyncLocalStorage();this.initiatorState='active';this.activeRuns=0
  ctx.inject(['typert'],child=>{child.typert.lookups.register('agent',{parameter:'agent',wire:'agentId',hostTypeSymbol:'@deepseek-ai/dsh-agent#Agent',wireTypeSymbol:'@deepseek-ai/dsh-session/types#SessionId',resolve:id=>this.get(id)});child.typert.contexts.registerHost('agent',{wire:'agentId',wireTypeSymbol:'@deepseek-ai/dsh-session/types#SessionId',resolve:id=>this.get(id)?.ctx})})
  ctx.on('internal/status',fiber=>{if(fiber.state===5&&this.ownsLifecycle(fiber))this.closeInitiators()})
  ctx.effect(function*(){yield()=>this.disposeInitiators();yield()=>this.closeInitiators()}.bind(this),'native agent attribution lifecycle')
  ctx.on('workspace/session-activity',async({sessionId},next)=>{const running=this.get(sessionId)?.status==='running',rest=await next();return running?[{kind:'turn'},...rest]:rest})
  ctx.on('workspace/session-stop',({sessionId})=>{const agent=this.get(sessionId);if(agent?.status==='running')agent.cancel({kind:'user'})})
 }
 ownsLifecycle(candidate){let fiber=this.ctx.fiber;while(fiber){if(fiber===candidate)return true;const parent=fiber.parent.fiber;if(parent===fiber)return false;fiber=parent}return false}
 currentInitiator(){if(this.initiatorState==='disposed')throw new Error('agent initiator scope is disposed');return this.initiators.getStore()}
 requireInitiator(){const agent=this.currentInitiator();if(agent===undefined)throw new Error('no initiating agent is active');return agent}
 withInitiator(agent,operation){return this.runInitiator(agent,operation)}
 withoutInitiator(operation){return this.runInitiator(undefined,operation)}
 runInitiator(agent,operation){
  if(this.initiatorState!=='active')throw new Error('agent initiator scope is disposed')
  const run={active:true,parent:this.runs.getStore()};this.activeRuns++;let result
  try{result=this.runs.run(run,()=>this.initiators.run(agent,operation))}catch(error){this.releaseRun(run);throw error}
  if(isPromise(result))try{Promise.prototype.then.call(result,()=>this.releaseRun(run),()=>this.releaseRun(run))}catch{this.releaseRun(run)}else this.releaseRun(run)
  return result
 }
 releaseRun(run){if(!run.active)return;run.active=false;this.activeRuns--;if(!this.activeRuns){this.initiatorDrain?.resolve();this.initiatorDrain=undefined}}
 closeInitiators(){if(this.initiatorState==='active')this.initiatorState='closing'}
 disposeInitiators(){return this.initiatorDisposal??=(async()=>{this.closeInitiators();let run=this.runs.getStore();while(run){this.releaseRun(run);run=run.parent}if(this.activeRuns){this.initiatorDrain??=Promise.withResolvers();await this.initiatorDrain.promise}this.initiatorState='disposed';this.initiators.disable();this.runs.disable()})()}
 setFactory(factory){return this.ctx.effect(()=>{if(this.factory)throw new Error('an agent factory is already registered');this.factory=factory[symbols.original]??factory;return()=>{this.factory=undefined}},'native agents factory')}
 requireFactory(){if(!this.factory)throw new Error('no agent factory registered (load an agent-loop plugin)');return this.factory}
 async create(options){const owner=this.ctx,target=this.requireFactory();return Reflect.apply(target.createAgent,getTraceable(owner,target),[owner,options])}
 async resume(options){const owner=this.ctx,target=this.requireFactory();return Reflect.apply(target.resume,getTraceable(owner,target),[owner,options])}
 register(agent){return this.ctx.effect(async function*(){yield this.enter(agent,undefined);await this.announce(agent,'startup')}.bind(this),'native agents registration')}
 enter(agent,owner){
  if(agent.id!==agent.session.id)throw new Error('agent identity must match its session')
  if(this.entries.has(agent.id))throw new Error(`agent "${agent.id}" is already registered`)
  const entry={id:agent.id,agent,owner,carrier:scopeTarget(agent,agent),announced:false,announcing:false,pendingDetach:false};this.entries.set(agent.id,entry);let attached=true
  return()=>{if(!attached)return;attached=false;if(entry.announcing)entry.pendingDetach=true;else this.detach(entry)}
 }
 detach(entry){entry.pendingDetach=false;if(this.entries.get(entry.id)!==entry)return;this.entries.delete(entry.id);if(!entry.announced)return;const args=[entry.carrier,'agent/disposed',{agent:entry.agent}];for(const listener of this.ctx.events.dispatch('emit',args))try{Promise.resolve(listener(...args)).catch(error=>this.ctx.logger.warn(error))}catch(error){this.ctx.logger.warn(error)}}
 async announce(agent,source,signal){const entry=this.entries.get(agent.id);if(!entry||entry.agent!==agent)throw new Error('agent is not live in this registry');if(entry.announced||entry.announcing)throw new Error('agent was already announced');entry.announcing=true;entry.announced=true;try{await this.ctx.serial(entry.carrier,'agent/created',{agent,source,...signal===undefined?{}:{signal}})}finally{entry.announcing=false;if(entry.pendingDetach)this.detach(entry)}}
 get(id){return this.entries.get(id)?.agent}
 isOwnedBy(id,owner){return this.entries.get(id)?.owner===owner}
 list(){return[...this.entries.values()].map(e=>e.agent)}
 roots(){return[...this.entries.values()].filter(e=>e.owner===undefined).map(e=>e.agent)}
}
