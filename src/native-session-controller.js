import {Service} from '@deepseek-ai/cordis'

/** Host-only ordinary-session activation. Delegated sessions remain owned by
 * NativeSubagents; inspecting a binding never creates or resumes an agent. */
export default class NativeSessionController extends Service {
  static inject = ['agents','sessionPersistence','agentPresets','agentDefaultModel','permissionPresets','workspaceRegistry']
  constructor(ctx) {
    super(ctx,'sessionController')
    this.pending=new Map();this.handles=new Map();this.closing=false
    ctx.effect(()=>async()=>{
      this.closing=true
      await Promise.allSettled([...this.pending.values()])
      await Promise.all([...this.handles.values()].map(handle=>handle.dispose()))
    })
  }
  async header(id) {
    if(typeof id!=='string'||!id.trim())throw new Error('NIGHT_SESSION_ID_INVALID')
    const header=this.ctx.agents.get(id)?.metadata??(await this.ctx.sessionPersistence.stat(id))?.header
    if(!header)throw new Error('NIGHT_SESSION_NOT_FOUND')
    return structuredClone(header)
  }
  assertOrdinary(header) {
    if(header.agentPreset==='night-bot-task')throw new Error('NIGHT_SESSION_TASK_OWNED')
    if(header.origin==='subagent'||(header.delegationDepth??0)>0)throw new Error('NIGHT_SESSION_SUBAGENT_OWNED')
    if(this.ctx.workspaceRegistry.archivedSessionIds.includes(header.id))throw new Error('NIGHT_SESSION_ARCHIVED')
    if(!header.cwd)throw new Error('NIGHT_SESSION_CWD_REQUIRED')
  }
  async resolveAgent(id) {
    if(this.closing)return {error:new Error('NIGHT_SESSION_CONTROLLER_CLOSED')}
    let pending=this.pending.get(id)
    if(!pending){
      pending=this.ctx.agents.withoutInitiator(async()=>{
        this.assertOrdinary(await this.header(id))
        const live=this.ctx.agents.get(id)
        if(live)return {agent:live}
        const saved=await this.ctx.sessionPersistence.readNative(id)
        this.assertOrdinary(saved.header)
        const preset=saved.header.agentPreset,projection=saved.context?.projection
        const model=projection?.model?{provider:projection.model.provider,model:projection.model.modelId,...projection.thinkingLevel?{reasoningEffort:projection.thinkingLevel}:{}}:this.ctx.agentDefaultModel.currentSelection()
        const handle=await this.ctx.agents.resume({resumeSessionId:id,agentOptions:model,
          authorizeInput:(packet,actor)=>this.ctx.get('schedule')?.authorizeInput(packet,actor)??false,
          setup:async agentCtx=>{await agentCtx.get('agentPresets').mount(agentCtx,preset)}})
        this.handles.set(id,handle)
        return {agent:handle.agent}

      }).catch(error=>({error})).finally(()=>this.pending.delete(id))
      this.pending.set(id,pending)
    }
    return pending
  }
}
