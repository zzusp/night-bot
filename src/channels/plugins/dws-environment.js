import {join} from 'node:path'
import {failure} from '../../runtime/files.js'

/** DWS v1.0.63 stores Windows credentials in user-wide DPAPI/HKCU slots.
 * No supported production environment override isolates those slots. */
export function dwsEnvironment(paths,privateHome,cache,{platform=process.platform,inherited=process.env}={}){
  if(platform==='win32')throw failure('DWS_WINDOWS_ACCOUNT_ISOLATION_UNAVAILABLE')
  // Do not inherit another CLI account, keychain fallback mode or test namespace.
  const environment=Object.fromEntries(Object.entries(inherited).filter(([key])=>!/^DWS_/i.test(key)))
  return {...environment,HOME:privateHome,USERPROFILE:privateHome,
    DWS_CONFIG_DIR:join(privateHome,'config'),DWS_KEYCHAIN_DIR:join(privateHome,'keychain'),
    XDG_CONFIG_HOME:join(privateHome,'config'),XDG_DATA_HOME:join(privateHome,'share'),XDG_CACHE_HOME:cache,
    TMPDIR:paths.temp,TMP:paths.temp,TEMP:paths.temp}
}
