import {Service} from '@deepseek-ai/cordis'
import schema from '@deepseek-ai/schemastery'
import {z} from 'zod'
import {isAbsolute,resolve,dirname,basename,relative} from 'node:path'
import {lstatSync,realpathSync} from 'node:fs'
const actorPolicies=new WeakMap()
const unbound=()=>Object.assign(new Error('Official sandbox actor is not bound'),{code:'PI_SANDBOX_ACTOR_UNBOUND'})
export function bindSandboxPolicyActor(actor,port){
 if(!actor||!port||typeof port.initialDirectory!=='string'||!isAbsolute(port.initialDirectory))throw new TypeError('Absolute initial directory required')
 const prior=actorPolicies.get(actor);if(prior){if(prior.source!==port)throw new Error('Sandbox actor already bound');return()=>{}}
 const bound={source:port,initialDirectory:port.initialDirectory}
 for(const name of ['readPolicy','appendPolicy','isLive']){if(typeof port[name]!=='function')throw new TypeError('Sandbox port requires '+name);bound[name]=port[name].bind(port)}
 Object.freeze(bound);actorPolicies.set(actor,bound)
 return()=>{if(actorPolicies.get(actor)===bound)actorPolicies.delete(actor)}
}
function officialPolicy(actor){const port=actorPolicies.get(actor);if(!port||!port.isLive(actor))throw unbound();return port}
export const SANDBOX_MODES=Object.freeze(['read-only','workspace-write','danger-full-access'])
const mode=value=>{if(!SANDBOX_MODES.includes(value))throw new Error('Unsupported sandbox mode');return value}
const absolute=path=>{if(typeof path!=='string'||!isAbsolute(path))throw new Error('sandbox-policy: workspace root must be an absolute execution-world path');return path}
export function setSandboxMode(session,value){if(actorPolicies.has(session)||session?.piSession)return officialPolicy(session).appendPolicy({mode:mode(value)});session.append('sandbox/mode',{mode:mode(value)})}
export function checkedArtifactBinding(value){
 if(!value||typeof value.ownerId!=='string'||!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(value.ownerId)||typeof value.artifactRoot!=='string'||!isAbsolute(value.artifactRoot)||typeof value.sessionCwd!=='string'||!isAbsolute(value.sessionCwd))throw new Error('ARTIFACT_POLICY_BINDING_INVALID')
 const root=resolve(value.artifactRoot);if(root!==value.artifactRoot||basename(root)!=='outputs'||basename(dirname(root))!==value.ownerId||basename(dirname(dirname(root)))!=='tasks')throw new Error('ARTIFACT_POLICY_ROOT_INVALID')
 for(let path=root;;){const info=lstatSync(path);if(!info.isDirectory()||info.isSymbolicLink())throw new Error('ARTIFACT_POLICY_ROOT_LINK');const parent=dirname(path);if(parent===path)break;path=parent}
 if(relative(root,realpathSync(root))!=='')throw new Error('ARTIFACT_POLICY_ROOT_LINK')
 return{ownerId:value.ownerId,artifactRoot:root,sessionCwd:value.sessionCwd}
}
function policyText(policy){
 if(policy.mode==='read-only')return'Current file policy: read-only. Available operations enforced by the file sandbox cannot modify files in the standing mode. Do not refuse a required modification from this policy alone: try an available tool normally and follow its denial and escalation guidance.'
 if(policy.mode==='workspace-write')return`Current file policy: workspace-write. Available operations enforced by the file sandbox may modify files under the session workspace: ${JSON.stringify(policy.workspaceRoot)}. Some platform temporary areas may also be writable.`
 return'Current file policy: danger-full-access. The file sandbox does not restrict file modifications by available operations.'
}
const bindingSchema=z.strictObject({ownerId:z.string(),artifactRoot:z.string(),sessionCwd:z.string()}).nullable()
export default class NativePolicy extends Service{
 static inject=['sessionProjections']
 static Config=schema.object({mode:schema.union([...SANDBOX_MODES]).default('read-only'),workspaceRoot:schema.string()})
 constructor(ctx,config={}){
  super(ctx,'sandboxPolicy');this.defaultMode=mode(config.mode??'read-only');this.workspaceRoot=absolute(config.workspaceRoot??process.cwd())
  ctx.sessionProjections.register({key:'sandboxMode',stateVersion:1,stateSchema:z.enum(SANDBOX_MODES).nullable(),init:()=>null,apply:(state,event)=>event.type==='sandbox/mode'?event.data.mode:state})
  ctx.sessionProjections.register({key:'sandboxArtifactRoot',stateVersion:1,stateSchema:bindingSchema,init:()=>null,apply:(state,event)=>event.type==='sandbox/mode'&&event.data.artifactRoot?event.data.artifactRoot:state})
  ctx.inject(['systemPrompt'],scope=>scope.systemPrompt.context({name:'sandbox:policy',order:scope.systemPrompt.getContextOrder('SANDBOX_POLICY'),required:true,officialText:({actor})=>policyText(this.resolve({actor})),text:context=>context.agent?.session?policyText(this.resolve({session:context.agent.session})):''}))
 }
 overrideOf(session){return this.ctx.sessionProjections.stateOf(session,'sandboxMode')??undefined}
 resolve(request={}){const actor=request.actor??(request.agent?.piSession?request.agent:undefined);if(actor){const port=officialPolicy(actor),snapshot=port.readPolicy();if(!snapshot||typeof snapshot!=='object')throw new Error('Invalid official sandbox snapshot');const binding=snapshot.artifactRoot;if(binding){checkedArtifactBinding(binding);if(binding.sessionCwd!==port.initialDirectory)throw new Error('ARTIFACT_POLICY_SESSION_CHANGED')}return{mode:mode(snapshot.mode??this.defaultMode),workspaceRoot:binding?.artifactRoot??port.initialDirectory,sessionId:actor.id}}const session=request.session??request.agent?.session,binding=session?this.ctx.sessionProjections.stateOf(session,'sandboxArtifactRoot'):undefined;if(binding){checkedArtifactBinding(binding);if(session.header.cwd!==binding.sessionCwd)throw new Error('ARTIFACT_POLICY_SESSION_CHANGED')}return{mode:mode(request.mode??(session?this.overrideOf(session):undefined)??this.defaultMode),workspaceRoot:binding?.artifactRoot??absolute(session?.header.cwd??this.workspaceRoot),...session?{sessionId:session.id}:{}}}
 bindArtifactRoot(session,value){if(actorPolicies.has(session)||session?.piSession){const port=officialPolicy(session),binding=checkedArtifactBinding({...value,sessionCwd:port.initialDirectory}),snapshot=port.readPolicy(),previous=snapshot.artifactRoot;if(previous){checkedArtifactBinding(previous);if(JSON.stringify(previous)!==JSON.stringify(binding))throw new Error('ARTIFACT_POLICY_BINDING_CHANGED');return Promise.resolve(previous)}return Promise.resolve(port.appendPolicy({mode:mode(snapshot.mode??this.defaultMode),artifactRoot:binding})).then(()=>binding)}const binding=checkedArtifactBinding({...value,sessionCwd:session.header.cwd}),previous=this.ctx.sessionProjections.stateOf(session,'sandboxArtifactRoot');if(previous){if(JSON.stringify(previous)!==JSON.stringify(binding))throw new Error('ARTIFACT_POLICY_BINDING_CHANGED');return previous}session.append('sandbox/mode',{mode:this.overrideOf(session)??this.defaultMode,artifactRoot:binding});return binding}
}
