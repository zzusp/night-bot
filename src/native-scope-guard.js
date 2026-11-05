import {createRequire} from 'node:module'
import {realpathSync} from 'node:fs'
import {fileURLToPath} from 'node:url'

// Check resolution before loading SDK helpers: a second private Scope graph would
// silently lose permission ancestry and event routing across the compatibility ABI.
export function assertNativeScopeAuthority() {
  const require=createRequire(import.meta.url)
  const expected=realpathSync(fileURLToPath(new URL('../packages/scope-compat/index.js',import.meta.url)))
  for(const name of ['session','tools','skill','subagent']) {
    const peer=createRequire(require.resolve('@deepseek-ai/dsh-'+name))
    if(realpathSync(peer.resolve('@deepseek-ai/dsh-scope'))!==expected) {
      const error=new Error('Scope authority mismatch: '+name)
      error.code='NIGHT_BOT_SCOPE_AUTHORITY_MISMATCH'
      throw error
    }
  }
}
