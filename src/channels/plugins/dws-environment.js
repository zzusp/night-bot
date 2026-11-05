import {join} from 'node:path'
import {failure} from '../../runtime/files.js'

/** Existing CLI credentials remain owned/protected by the operating system.
 * Project-owned storage and independent third-party login are different scopes. */
export function dwsAccountPolicy(accountMode,{platform=process.platform}={}){
  const mode=accountMode??(platform==='win32'?'system':'private')
  if(!['system','private'].includes(mode))throw failure('DWS_ACCOUNT_MODE_INVALID')
  if(mode==='private'&&platform==='win32')throw failure('DWS_PRIVATE_ACCOUNT_UNSUPPORTED_ON_WINDOWS')
  return {mode,credentialScope:mode==='system'?'os-user':'plugin-directory',
    sharedAcrossInstances:mode==='system',independentLogin:mode==='private',
    configurationOwner:mode==='system'?'external-cli':'night-bot',
    ...(platform==='darwin'&&mode==='private'?{encryptionKeyScope:'os-user-keychain'}:{})}
}
export function dwsEnvironment(paths,privateHome,cache,{platform=process.platform,inherited=process.env,accountMode}={}){
  const policy=dwsAccountPolicy(accountMode,{platform})
  // Do not inject plaintext auth overrides, test namespaces or weaker keychain modes.
  const environment=Object.fromEntries(Object.entries(inherited).filter(([key])=>!/^DWS_/i.test(key)))
  const temp={TMPDIR:paths.temp,TMP:paths.temp,TEMP:paths.temp}
  if(policy.mode==='system'){
    // Preserve the current user's actual CLI config selection and home; no copying,
    // relocation, credential export or changes to DPAPI/Keychain protection.
    for(const key of ['DWS_CONFIG_DIR','DWS_KEYCHAIN_DIR'])if(inherited[key])environment[key]=inherited[key]
    return {...environment,...temp}
  }
  return {...environment,...temp,HOME:privateHome,USERPROFILE:privateHome,
    DWS_CONFIG_DIR:join(privateHome,'config'),DWS_KEYCHAIN_DIR:join(privateHome,'keychain'),
    XDG_CONFIG_HOME:join(privateHome,'config'),XDG_DATA_HOME:join(privateHome,'share'),XDG_CACHE_HOME:cache}
}
