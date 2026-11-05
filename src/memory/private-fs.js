import {officialWorkingDirectoryOrigin} from '../native-working-directory.js'
import NativeSandboxedFileSystem from '../native-fs-sandbox.js'
import {inside} from '../runtime/paths.js'
import {join,relative} from 'node:path'
import {FsError} from '../native-fs-protocol.js'
const origin=(agent,fallback)=>agent?.piSession?officialWorkingDirectoryOrigin(agent):agent?.session.header.cwd??fallback
/** Keep the original write sandbox; add a model-only raw-state read fence. */
export default class PrivateFileSystem extends NativeSandboxedFileSystem {
  static inject=['sandboxPolicy','memoryPrivacy']
  check(target){
    const actor=this.ctx.get('agents')?.currentInitiator();if(actor?.piSession)officialWorkingDirectoryOrigin(actor)
    if(actor&&this.ctx.memoryPrivacy.denied(String(target.targetKey),actor))throw new FsError('Application state is private; use authorized memory/attachment/session tools.','FS_SANDBOX_DENIED')
    return target
  }
  async resolve(path,options){return this.check(await super.resolve(path,options))}
  async stat(target,...args){if(this.outside(target))return undefined;return super.stat(this.check(target),...args)}
  outside(target,writing=false){const agent=this.ctx.get('agents')?.currentInitiator();if(!agent||!this.ctx.memoryPrivacy.installRoot)return false;const path=String(target.targetKey),workspace=origin(agent,this.ctx.memoryPrivacy.workspaces);return !inside(writing?workspace:this.ctx.memoryPrivacy.installRoot,path)||inside(this.ctx.memoryPrivacy.workspaces,path)&&!inside(workspace,path)&&!inside(path,workspace)}
  boundary(target,writing=false){const agent=this.ctx.get('agents')?.currentInitiator(),path=String(target.targetKey);const workspace=origin(agent),task=workspace&&/^tasks[/\\][^/\\]+$/.test(relative(this.ctx.memoryPrivacy.workspaces,workspace));if(writing&&task&&!['work','tmp'].some(name=>inside(join(workspace,name),path)))throw new FsError('Task archive areas are Host-owned; write process files under work/ or tmp/.','FS_SANDBOX_DENIED');if(agent&&this.ctx.memoryPrivacy.installRoot&&inside(this.ctx.memoryPrivacy.workspaces,path)&&!inside(origin(agent,this.ctx.memoryPrivacy.workspaces),path))throw new FsError('Another conversation/task workspace is private.','FS_SANDBOX_DENIED');if(this.outside(target,writing))throw new FsError('Business files belong under the installation workspace.','FS_SANDBOX_DENIED');return this.check(target)}
  async checkedTarget(target,policy){
    const actor=this.ctx.get('agents')?.currentInitiator()
    if(actor?.piSession){officialWorkingDirectoryOrigin(actor);const bound=this.ctx.sandboxPolicy.resolve({actor});policy??=bound}
    return super.checkedTarget(target,policy)
  }
  async readText(target,...args){return super.readText(this.boundary(target),...args)}
  async readBytes(target,...args){return super.readBytes(this.boundary(target),...args)}
  async readByteRange(target,...args){return super.readByteRange(this.boundary(target),...args)}
  async listDir(target,...args){return super.listDir(this.boundary(target),...args)}
  async writeText(target,...args){return super.writeText(this.boundary(target,true),...args)}
  async editText(target,...args){return super.editText(this.boundary(target,true),...args)}
}
