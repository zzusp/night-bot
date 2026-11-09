// 原MIT派生业务逻辑归同目录native-tool-bash.js；许可见licenses/dsh-tool-pwsh-MIT.txt。
import {Config,inject,applyShellTool} from './native-tool-bash.js'
const name='night-native-tool-pwsh'
function apply(ctx,config={}){return applyShellTool(ctx,config,'pwsh')}
export {Config,inject,name,apply}
