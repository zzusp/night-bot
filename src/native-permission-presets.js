import schema from '@deepseek-ai/schemastery'
import {z} from 'zod'
import {Service} from '@deepseek-ai/cordis'
import {SANDBOX_MODES} from './native-policy.js'
import {APPROVAL_POLICIES} from './native-approval.js'
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
/** Permission choices are single durable business facts, never Session events. */
export default class NativePermissionPresets extends Service {
 static inject=['shell','approval','sandboxPolicy']
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
  ctx.inject(['commands'],child=>child.commands.register({definitionId:'night-bot:permission-presets',name:'permission',description:'Switch the permission preset (sandbox mode + approval policy)',input:{hint:'<preset>'},handler:({agent,rawInput})=>{if(this.host.get('toolPermissions'))return{kind:'error',text:'权限模式仅可由安装操作者通过CLI或认证Web修改。'};const target=agent,name=rawInput.trim();if(!name)return{kind:'success',text:`current preset ${this.current(target)} (available: ${this.names.join(', ')})`};if(!this.names.includes(name))return{kind:'error',text:`unknown preset "${name}" (available: ${this.names.join(', ')})`};const result=this.selectOfficial(target,name);const reply={kind:'success',text:`preset ${name}`};return result&&typeof result.then==='function'?result.then(()=>reply):reply}}))
 }
 assertOpen(){if(this.closed)throw new Error('Permission preset service disposed')}
 get names(){return[...Object.keys(this.presets),...this.auto?[AUTO_PRESET]:[]]}
 get defaultPreset(){return this.defaultSettings().defaultPreset}
 specOf(name){return Object.hasOwn(this.presets,name)?this.presets[name]:name===AUTO_PRESET&&this.auto?autoSpec:undefined}
 resolve(name){const spec=this.specOf(name);if(!spec)throw new Error(`permission: unknown preset "${name}" (known: ${this.names.join(', ')})`);return spec}
 optionOf(name){if(name===CUSTOM_PRESET)return{value:CUSTOM_PRESET,name:'Custom',description:'Current sandbox and approval settings do not match a preset.'};const spec=this.resolve(name);return{value:name,name:spec.name??name,...spec.description===undefined?{}:{description:spec.description}}}
 catalog(){return{options:this.names.map(n=>this.optionOf(n)),defaultOptions:Object.keys(this.presets).map(n=>this.optionOf(n)),defaultPreset:this.defaultPreset}}
 permissionState(actor){const port=permissionPort(actor),state=permissionSchema.parse(port.readPermissions()),sandbox=this.ctx.sandboxPolicy.resolve({actor}).mode,approval=this.ctx.approval.policyForActor(actor);if(state.sandbox!==null&&state.sandbox!==sandbox||state.approval!==null&&state.approval!==approval)throw Object.assign(new Error('Permission snapshot differs from bound sandbox/approval'),{code:'PI_PERMISSION_STATE_MISMATCH'});return{...state,sandbox,approval}}
 derive(state){const sandbox=state.sandbox??this.ctx.shell.sandboxMode,approval=state.approval??this.ctx.approval.config.policy??'ask',matches=spec=>spec.sandbox===sandbox&&spec.approval===approval;if(state.preset!==null){const spec=this.specOf(state.preset);if(spec&&matches(spec))return state.preset;if(state.preset===AUTO_PRESET&&spec?.sandbox===sandbox&&approval==='never')return AUTO_PRESET}for(const [name,spec]of Object.entries(this.presets))if(matches(spec))return name;return CUSTOM_PRESET}
 current(actor){return this.derive(this.permissionState(actor))}
 admitAuto(){const record=this.auto;if(!record)throw new Error('permission: cannot restore auto without active integration');const result=record.admit();if(result&&typeof result.then==='function'){void Promise.resolve(result).catch(()=>{});throw new Error('permission: Auto admission must be synchronous')}this.assertOpen();if(this.auto!==record)throw new Error('permission: Auto integration revoked during admission')}
 registerAuto(admit){if(typeof admit!=='function')throw new TypeError('Auto admission gate required');return this.ctx.effect(()=>{this.assertOpen();if(this.auto)throw new Error('permission: auto already registered');const record={admit};this.auto=record;this.emitCatalogChanged();return()=>{if(this.auto===record){this.auto=undefined;this.emitCatalogChanged()}}},'native Auto registration')}
 authorizeMemoryWrite(actor){this.assertOpen();permissionPort(actor);return this.permissionState(actor).sandbox!=='read-only'}
 select(actor,name){return this.set(actor,name)}
 set(actor,name){return this.selectOfficial(actor,name)}
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

 pinInitialPermission(actor){const state=permissionSchema.parse(permissionPort(actor).readPermissions());if(state.preset===AUTO_PRESET)this.admitAuto();const name=state.preset===null&&state.sandbox===null&&state.approval===null&&!state.seeded?this.defaultPreset:this.current(actor);if(name===CUSTOM_PRESET)return;return this.selectOfficial(actor,name)}
 emitCatalogChanged(){try{for(const fn of this.host.events.dispatch('emit',['permission-presets/catalog-changed']))try{Promise.resolve(fn()).catch(()=>this.warn())}catch{this.warn()}}catch{this.warn()}}
 warn(){try{this.host.logger.warn('permission: catalog-changed listener failed')}catch{}}
}
