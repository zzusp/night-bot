// Retains MIT-derived capability/observation contracts; see licenses/dsh-fs-MIT.txt.
// Night's Host IO capability. These errors and opaque metadata are application
// policy/IO facts; Pi's tool definitions own the model-facing file protocol.
import {Service} from '@deepseek-ai/cordis'
import {HarnessError} from './native-llm-protocol.js'

export class FsError extends HarnessError{
 constructor(message,code,options){super(message,code,options);this.code=code}
}
// Identity tokens come only from a trusted backend. These helpers perform no
// coercion, parsing, authorization or conversion of historical data.
export const FsTargetKey=value=>value
export const FsVersion=value=>value
export class FileSystem extends Service{
 constructor(ctx){super(ctx,'fs')}
 watch(_target,_changed,signal){signal.throwIfAborted();return Promise.reject(new FsError('Filesystem observation is unavailable','FS_IO_ERROR'))}
 get sandboxMode(){return undefined}
 processPathFromHostPath(_path){return undefined}
}
export default FileSystem
