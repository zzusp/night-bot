import {createRequire} from 'node:module'
import {realpathSync} from 'node:fs'
import {fileURLToPath} from 'node:url'

// Check resolution before loading SDK helpers: a second private Scope graph would
// silently lose permission ancestry and event routing across the compatibility ABI.
export function assertNativeScopeAuthority() {
  const require=createRequire(import.meta.url)
  const expected=realpathSync(fileURLToPath(new URL('../packages/scope-compat/index.js',import.meta.url)))
  for(const name of ['session','tools','subagent']) {
    const peer=createRequire(require.resolve('@deepseek-ai/dsh-'+name))
    if(realpathSync(peer.resolve('@deepseek-ai/dsh-scope'))!==expected) {
      const error=new Error('Scope authority mismatch: '+name)
      error.code='NIGHT_BOT_SCOPE_AUTHORITY_MISMATCH'
      throw error
    }
  }
  // Skills now import the canonical scope directly. Check their compatibility
  // entry, using the retained ACL peer when the development root alias is absent.
  let skill
  try { skill=require.resolve('@deepseek-ai/dsh-skill') }
  catch(error) {
    if(error.code!=='MODULE_NOT_FOUND')throw error
    skill=createRequire(require.resolve('@deepseek-ai/dsh-sandbox-windows-acl')).resolve('@deepseek-ai/dsh-skill')
  }
  const nativeSkill=realpathSync(fileURLToPath(new URL('../packages/capability-compat/skill/index.js',import.meta.url)))
  if(realpathSync(skill)!==nativeSkill)throw Object.assign(new Error('Scope authority mismatch: native skill owner'),{code:'NIGHT_BOT_SCOPE_AUTHORITY_MISMATCH'})
}
