import schema from '@deepseek-ai/schemastery'
import {z} from 'zod'
import {Service} from '@deepseek-ai/cordis'
import {SANDBOX_MODES,setSandboxMode} from './native-policy.js'
import {APPROVAL_POLICIES,setApprovalPolicy} from './native-approval.js'
const officialPermissions=new WeakMap()
const actorError=()=>Object.assign(new Error('Official permission actor is not bound'),{code:'PI_PERMISSION_ACTOR_UNBOUND'})
export function bindPermissionPresetActor(actor,port){
 if(!actor||!port)throw new TypeError('Permission actor and business port required')
 const previous=officialPermissions.get(actor);if(previous){if(previous.source!==port)throw new Error('Permission actor already bound');return()=>{}}
 const bound={source:port,failure:undefined}
 for(const name of ['readPermissions','commitPermissions','isLive']){if(typeof port[name]!=='function')throw new TypeError('Permission port requires '+name);bound[name]=port[name].bind(port)}
 officialPermissions.set(actor,bound)
 return()=>{if(officialPermissions.get(actor)===bound)officialPermissions.delete(actor)}
}
function permissionPort(actor){const port=officialPermissions.get(actor);if(!port||!port.isLive(actor))throw actorError();if(port.failure)throw port.failure;return port}
export const CUSTOM_PRESET='custom',AUTO_PRESET='auto'
const autoSpec=Object.freeze({sandbox:'danger-full-access',approval:'ask'})
const defaults=()=>({'workspace-write':{sandbox:'workspace-write',approval:'ask',name:'workspace-write',description:'Write inside the workspace and permitted temporary directories; wider retries require approval.'},'danger-full-access':{sandbox:'danger-full-access',approval:'never',name:'danger-full-access',description:'Full file access without approval prompts.'}})
const permissionSchema=z.object({preset:z.string().nullable(),sandbox:z.enum(SANDBOX_MODES).nullable(),approval:z.enum(APPROVAL_POLICIES).nullable(),seeded:z.boolean()}).strict()
const empty=()=>({preset:null,sandbox:null,approval:null,seeded:false})
function fold(state,event){switch(event.type){case'permission/preset':return{...state,preset:event.data.preset};case'sandbox/mode':return{...state,sandbox:event.data.mode};case'approval/policy':return{...state,approval:event.data.policy};case'session/end-seed':return{...state,seeded:true};default:return state}}
/** Application-owned preset math/publication. Canonical knob setters retain
 * event compatibility; a live Auto integration must admit before any write. */
export default class NativePermissionPresets extends Service {
 static inject=['shell','approval','sandboxPolicy','sessionProjections']
 static Config=schema.object({presets:schema.dict(schema.object({sandbox:schema.union([...SANDBOX_MODES]).required(),approval:schema.union([...APPROVAL_POLICIES]).required(),name:schema.string(),description:schema.string()})).default(defaults()),defaultPreset:schema.string().volatile()})
 constructor(ctx,config={}){
  super(ctx,'permissionPresets');this.host=ctx;this.officialTails=new WeakMap();this.closed=false;this.auto=undefined;this.presets=config.presets??defaults();this.selectedDefault=typeof config.defaultPreset?.get==='function'?()=>config.defaultPreset.get():()=>config.defaultPreset
  for(const reserved of [CUSTOM_PRESET,AUTO_PRESET])if(Object.hasOwn(this.presets,reserved))throw new Error('permission: reserved preset '+reserved)
  for(const spec of Object.values(this.presets))if(!SANDBOX_MODES.includes(spec.sandbox)||!APPROVAL_POLICIES.includes(spec.approval))throw new Error('permission: invalid preset knobs')
  if(ctx.shell.sandboxMode===undefined)throw new Error('permission: executor does not confine (no sandboxMode)')
  const inferred=this.derive(empty()),chosen=this.selectedDefault()??inferred;if(chosen===CUSTOM_PRESET)throw new Error('permission: defaults match no preset; configure defaultPreset');this.resolve(chosen)
  this.defaultSettings=()=>{const defaultPreset=this.selectedDefault()??inferred;if(!Object.hasOwn(this.presets,defaultPreset))throw new Error('permission: unknown default preset '+defaultPreset);return{defaultPreset}}
  ctx.effect(()=>()=>{this.closed=true},'native permission preset teardown')
  ctx.inject(['settings'],child=>child.effect(()=>child.settings.configure({auto:false},ctx.fiber)))
  ctx.sessionProjections.register({key:'permissions',stateVersion:2,stateSchema:permissionSchema,init:empty,apply:fold,wire:{viewSchema:z.object({currentValue:z.string().min(1)}),view:state=>({currentValue:this.derive(state)})}})
  // Explicit legacy installations retain their own event publication. The
  // default official Host has no Session facade or legacy lifecycle listener.
  const legacySessions=ctx.get('sessions');if(legacySessions){ctx.on('session/created',session=>this.pinInitialPermission(session));for(const session of legacySessions.list())this.pinInitialPermission(session)}
  ctx.inject(['commands'],child=>child.commands.register({definitionId:'@deepseek-ai/dsh-permission-presets',name:'permission',description:'Switch the permission preset (sandbox mode + approval policy)',input:{hint:'<preset>'},handler:({agent,rawInput})=>{const target=agent.piSession?agent:agent.session,name=rawInput.trim();if(!name)return{kind:'success',text:`current preset ${this.current(target)} (available: ${this.names.join(', ')})`};if(!this.names.includes(name))return{kind:'error',text:`unknown preset "${name}" (available: ${this.names.join(', ')})`};const result=this.apply(target,name,policy=>this.ctx.approval.setPolicy(agent,policy));const reply={kind:'success',text:`preset ${name}`};return result&&typeof result.then==='function'?result.then(()=>reply):reply}}))
 }
 assertOpen(){if(this.closed)throw new Error('Permission preset service disposed')}
 get names(){return[...Object.keys(this.presets),...this.auto?[AUTO_PRESET]:[]]}
 get defaultPreset(){return this.defaultSettings().defaultPreset}
 specOf(name){return Object.hasOwn(this.presets,name)?this.presets[name]:name===AUTO_PRESET&&this.auto?autoSpec:undefined}
 resolve(name){const spec=this.specOf(name);if(!spec)throw new Error(`permission: unknown preset "${name}" (known: ${this.names.join(', ')})`);return spec}
 optionOf(name){if(name===CUSTOM_PRESET)return{value:CUSTOM_PRESET,name:'Custom',description:'Current sandbox and approval settings do not match a preset.'};const spec=this.resolve(name);return{value:name,name:spec.name??name,...spec.description===undefined?{}:{description:spec.description}}}
 catalog(){return{options:this.names.map(n=>this.optionOf(n)),defaultOptions:Object.keys(this.presets).map(n=>this.optionOf(n)),defaultPreset:this.defaultPreset}}
 permissionState(session){if(officialPermissions.has(session)||session?.piSession){const port=permissionPort(session),state=permissionSchema.parse(port.readPermissions()),sandbox=this.ctx.sandboxPolicy.resolve({actor:session}).mode,approval=this.ctx.approval.policyForActor(session);if(state.sandbox!==null&&state.sandbox!==sandbox||state.approval!==null&&state.approval!==approval)throw Object.assign(new Error('Permission snapshot differs from bound sandbox/approval'),{code:'PI_PERMISSION_STATE_MISMATCH'});return{...state,sandbox,approval}}const state=this.ctx.sessionProjections.stateOf(session,'permissions');if(state===undefined)throw new Error('permission: permissions projection is not registered');return state}
 derive(state){const sandbox=state.sandbox??this.ctx.shell.sandboxMode,approval=state.approval??this.ctx.approval.config.policy??'ask',matches=spec=>spec.sandbox===sandbox&&spec.approval===approval;if(state.preset!==null){const spec=this.specOf(state.preset);if(spec&&matches(spec))return state.preset;if(state.preset===AUTO_PRESET&&spec?.sandbox===sandbox&&approval==='never')return AUTO_PRESET}for(const [name,spec]of Object.entries(this.presets))if(matches(spec))return name;return CUSTOM_PRESET}
 current(session){return this.derive(this.permissionState(session))}
 admitAuto(){const record=this.auto;if(!record)throw new Error('permission: cannot restore auto without active integration');const result=record.admit();if(result&&typeof result.then==='function'){void Promise.resolve(result).catch(()=>{});throw new Error('permission: Auto admission must be synchronous')}this.assertOpen();if(this.auto!==record)throw new Error('permission: Auto integration revoked during admission')}
 registerAuto(admit){if(typeof admit!=='function')throw new TypeError('Auto admission gate required');return this.ctx.effect(()=>{this.assertOpen();if(this.auto)throw new Error('permission: auto already registered');const record={admit};this.auto=record;this.emitCatalogChanged();return()=>{if(this.auto===record){this.auto=undefined;this.emitCatalogChanged()}}},'native Auto registration')}
 authorizeMemoryWrite(actor){this.assertOpen();permissionPort(actor);return this.permissionState(actor).sandbox!=='read-only'}
 select(actor,name){return this.set(actor,name)}
 set(session,name){return this.apply(session,name,policy=>setApprovalPolicy(session,policy))}
 async selectOfficial(actor,name){
  const port=permissionPort(actor),spec=this.resolve(name)
  const previous=this.officialTails.get(actor)??Promise.resolve()
  const operation=previous.then(async()=>{
   this.assertOpen();permissionPort(actor);if(name===AUTO_PRESET)this.admitAuto()
   const state=this.permissionState(actor)
   if(this.derive(state)===name&&state.preset===name&&state.sandbox===spec.sandbox&&state.approval===spec.approval)return
   try{await port.commitPermissions({preset:name,sandbox:spec.sandbox,approval:spec.approval});this.assertOpen();permissionPort(actor);const committed=this.permissionState(actor);if(committed.preset!==name||committed.sandbox!==spec.sandbox||committed.approval!==spec.approval)throw Object.assign(new Error('Permission commit did not publish bound knobs'),{code:'PI_PERMISSION_STATE_MISMATCH'})}catch(cause){port.failure=cause;throw cause}
  })
  this.officialTails.set(actor,operation.catch(()=>{}));return operation
 }

 apply(session,name,setApproval){if(officialPermissions.has(session)||session?.piSession)return this.selectOfficial(session,name);this.assertOpen();const spec=this.resolve(name);if(name===AUTO_PRESET)this.admitAuto();const current=this.current(session),knobs=this.permissionState(session);if(current!==name)session.append('permission/preset',{preset:name});if(spec.sandbox!==(knobs.sandbox??this.ctx.shell.sandboxMode))setSandboxMode(session,spec.sandbox);if(spec.approval!==(knobs.approval??this.ctx.approval.config.policy??'ask'))setApproval(spec.approval)}
 pinInitialPermission(session){if(officialPermissions.has(session)||session?.piSession){const state=permissionSchema.parse(permissionPort(session).readPermissions());if(state.preset===AUTO_PRESET)this.admitAuto();const name=state.preset===null&&state.sandbox===null&&state.approval===null&&!state.seeded?this.defaultPreset:this.current(session);if(name===CUSTOM_PRESET)return;return this.selectOfficial(session,name)}this.assertOpen();const state=this.permissionState(session),{preset,sandbox,approval,seeded}=state;if(preset===AUTO_PRESET)this.admitAuto();if(preset===null&&sandbox===null&&approval===null&&!seeded){const name=this.defaultPreset,spec=this.resolve(name);session.append('permission/preset',{preset:name});setSandboxMode(session,spec.sandbox);setApprovalPolicy(session,spec.approval);return}const effective=this.derive(state);if(preset===null&&effective!==CUSTOM_PRESET)session.append('permission/preset',{preset:effective});if(sandbox===null)setSandboxMode(session,this.ctx.shell.sandboxMode);if(approval===null)setApprovalPolicy(session,this.ctx.approval.config.policy??'ask')}
 emitCatalogChanged(){try{for(const fn of this.host.events.dispatch('emit',['permission-presets/catalog-changed']))try{Promise.resolve(fn()).catch(()=>this.warn())}catch{this.warn()}}catch{this.warn()}}
 warn(){try{this.host.logger.warn('permission: catalog-changed listener failed')}catch{}}
}
