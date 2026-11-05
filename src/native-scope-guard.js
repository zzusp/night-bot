import * as native from './native-scope.js'
import * as compatibility from '../packages/scope-compat/index.js'
// No registry SDK Scope owners remain. Historical namespace resolution must
// expose exactly the application-owned graph, carriers and registration stores.
export function assertNativeScopeAuthority(){
 for(const name of ['scopeOf','createScope','bindScopeParent','scopeTarget','carrierKeyOf','ScopedLayers']){
  if(compatibility[name]!==native[name])throw Object.assign(new Error('Scope authority mismatch: '+name),{code:'NIGHT_BOT_SCOPE_AUTHORITY_MISMATCH'})
 }
}
