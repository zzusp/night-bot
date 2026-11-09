import {officialWorkingDirectoryOrigin} from '../native-working-directory.js'
import NativeSandboxedFileSystem from '../native-fs-sandbox.js'
import {inside} from '../runtime/paths.js'
import {join} from 'node:path'
import {FsError} from '../native-fs-protocol.js'
const origin=(agent,fallback)=>agent?.piSession?officialWorkingDirectoryOrigin(agent):agent?.session.header.cwd??fallback
/** Keep the original write sandbox; add a model-only raw-state read fence. */
export default class PrivateFileSystem extends NativeSandboxedFileSystem {
  static inject=['sandboxPolicy','memoryPrivacy']
  check(target){
    const actor=this.ctx.get('agents')?.currentInitiator();if(actor?.piSession)officialWorkingDirectoryOrigin(actor)
    if(actor&&this.ctx.memoryPrivacy.denied(String(target.targetKey),actor)&&!this.permission(target)?.full)throw new FsError('Application state is private; use authorized memory/attachment/session tools.','FS_SANDBOX_DENIED')
    return target
  }
  async resolve(path,options){return this.check(await super.resolve(path,options))}
  permission(target,writing=false){const actor=this.ctx.get('agents')?.currentInitiator();return actor&&this.ctx.get('tools')?.resolveFileAuthorization({actor,path:String(target.targetKey),writing})}
  async admit(target,writing=false){const actor=this.ctx.get('agents')?.currentInitiator(),permissions=this.ctx.get('toolPermissions');if(actor&&permissions&&this.outside(target,writing))await permissions.authorizeFile({actor,path:String(target.targetKey),writing});return this.boundary(target,writing)}
  async statWorkingDirectory(actor,path,signal){
    const permissions=this.ctx.get('toolPermissions')
    if(!permissions?.canStatWorkingDirectory({actor,path}))return this.stat(await this.resolve(path,{signal}),signal)
    // 官方当前 cwd 的存在性是 Host 元数据；此能力不授予业务读取或写入。
    const control=permissions.executionSignal(signal)
    const check=()=>{control.throwIfAborted();if(!permissions.canStatWorkingDirectory({actor,path}))throw new FsError('Working directory metadata authority expired.','FS_SANDBOX_DENIED')}
    check()
    const target=await super.resolve(path,{signal:control});check()
    if(String(target.targetKey)!==path)throw new FsError('Working directory identity changed.','FS_STALE_VERSION')
    const info=await super.stat(target,control);check();return info
  }
  async stat(target,...args){return super.stat(await this.admit(target),...args)}
  outside(target,writing=false){const agent=this.ctx.get('agents')?.currentInitiator();if(!agent||!this.ctx.memoryPrivacy.installRoot)return false;const path=String(target.targetKey),workspace=origin(agent,this.ctx.memoryPrivacy.workspaces);return !inside(writing?workspace:this.ctx.memoryPrivacy.installRoot,path)||inside(this.ctx.memoryPrivacy.workspaces,path)&&!inside(workspace,path)&&!inside(path,workspace)}
  boundary(target,writing=false){const agent=this.ctx.get('agents')?.currentInitiator(),path=String(target.targetKey);const task=this.ctx.memoryPrivacy.taskRoot(path),grant=this.permission(target,writing);if(agent&&writing&&task&&!['work','tmp'].some(name=>inside(join(task,name),path)))throw new FsError('Task archive areas are Host-owned; write process files under work/ or tmp/.','FS_SANDBOX_DENIED');if(grant?.full)return target;if(agent&&this.ctx.memoryPrivacy.installRoot&&inside(this.ctx.memoryPrivacy.workspaces,path)&&!inside(origin(agent,this.ctx.memoryPrivacy.workspaces),path))throw new FsError('Another conversation/task workspace is private.','FS_SANDBOX_DENIED');if(this.outside(target,writing)&&!grant)throw new FsError('Business files belong under the installation workspace.','FS_SANDBOX_DENIED');return this.check(target)}
  /** Non-mutating admission checks. The write never reuses a checked target:
   * execution resolves and checks the current boundary and CAS again. */
  async preflightPath(path,options={}){
    return this.admit(await super.preflightPath(path,options),true)
  }
  async preflightMutation(path,options={}){
    await super.preflightMutation(path,options)
  }
  async checkedTarget(target,policy){
    const actor=this.ctx.get('agents')?.currentInitiator()
    if(actor?.piSession){officialWorkingDirectoryOrigin(actor);const bound=this.ctx.sandboxPolicy.resolve({actor});policy??=bound}
    // SandboxedFileSystem may refresh an alias to a new canonical target.
    // Enforce the task-owned areas on that exact returned mutation target too.
    const fresh=await this.resolve(target.displayPath);await this.admit(fresh,true)
    if(this.permission(fresh,true))return fresh
    return this.boundary(await super.checkedTarget(fresh,policy),true)
  }
  async readText(target,...args){return super.readText(await this.admit(target),...args)}
  async readBytes(target,...args){return super.readBytes(await this.admit(target),...args)}
  async readByteRange(target,...args){return super.readByteRange(await this.admit(target),...args)}
  async listDir(target,...args){return super.listDir(await this.admit(target),...args)}
  async writeText(target,...args){return super.writeText(await this.admit(target,true),...args)}
}
