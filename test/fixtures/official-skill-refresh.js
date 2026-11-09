import {mkdir,writeFile} from 'node:fs/promises'
import {join} from 'node:path'
import {memoryHost} from './memory-host.js'
import {installSessionSkillRefresh} from '../../packages/dingtalk-core/session-skill-refresh.js'

export async function officialSkillRefreshFixture(t,{setup,dynamicAuthority=false}={}){
 let actions=[],remove,handle
 const f=await memoryHost(t,()=>actions.shift()??{text:'Verified current skill state'})
 const state={authorized:true,body:'ORIGINAL_BODY_ONLY',root:join(f.root,'data/workspaces/guide-one')}
 const definition=()=>({name:'guide',description:'Small guide summary',provider:dynamicAuthority?'fixture-authority':'fixture',source:'fixture',resourceBase:{kind:'directory',path:state.root},content:state.body,invocation:{modelInvocable:true,userInvocable:true}})
 const register=()=>{remove?.();remove=dynamicAuthority?f.host.ctx.skills.registerProvider(()=>({name:'fixture-authority',list:async()=>[{...definition(),rank:100,locator:'guide'}],get:async()=>state.authorized?definition():undefined})):f.host.ctx.skills.register(definition())}
 await mkdir(join(state.root,'references'),{recursive:true});await writeFile(join(state.root,'references/a.md'),'ORIGINAL_REFERENCE_ONLY');register()
 const create=()=>f.host.ctx.agents.create({sessionId:'official-skill-refresh',meta:{cwd:join(f.root,'data/workspaces'),agentPreset:'night-bot'},authorizeInput:packet=>packet.source.kind==='user',setup})
 handle=await create();let sequence=0
 const observation=()=>installSessionSkillRefresh(handle.actor.ctx,handle.actor,{cwd:handle.actor.metadata.cwd,signal:handle.actor.lifecycle.signal})
 t.after(async()=>{await handle.dispose();remove?.()})
 return {f,state,register,definition,observation,get handle(){return handle},
  async run(calls=[],text='Follow the current authorized guide without performing business effects.'){
   actions=[...calls];const id='skill-input-'+(++sequence);await handle.enqueue({id,source:{kind:'user'},content:text});await handle.deliver(id);await handle.whenIdle();if(actions.length)throw Error('Unconsumed scripted calls');return f.requests.at(-1)
  },async receipts(){return (await handle.actor.receipts.read()).filter(row=>row.domain==='skill-observation'&&row.kind==='read')},
  async saved(){return f.host.ctx.sessionPersistence.readNative(handle.actor.id,{requireComplete:true})},
  async resume(){await handle.dispose();handle=await f.host.ctx.agents.resume({sessionId:handle.actor.id,authorizeInput:packet=>packet.source.kind==='user'});return handle},
 }
}
