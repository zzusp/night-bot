import {readFile} from 'node:fs/promises'
import {parseEnv} from 'node:util'
import {homedir} from 'node:os'
import {join,resolve} from 'node:path'
const order=['process','project-env','user-env']
const bootstrap=new Set(('PATH HOME USERPROFILE SHELL NODE_OPTIONS NODE_PATH NODE_EXTRA_CA_CERTS LD_PRELOAD LD_LIBRARY_PATH LD_AUDIT BASH_ENV ENV SHELLOPTS BASHOPTS PERL5OPT PERL5LIB PYTHONSTARTUP PYTHONPATH RUBYOPT RUBYLIB JAVA_TOOL_OPTIONS _JAVA_OPTIONS JDK_JAVA_OPTIONS PYTHONHOME GIT_SSH GIT_SSH_COMMAND GIT_EXTERNAL_DIFF GIT_PAGER GIT_EDITOR GIT_ASKPASS SSH_ASKPASS GIT_CONFIG_GLOBAL GIT_CONFIG_SYSTEM GIT_CONFIG_COUNT EDITOR VISUAL PAGER BROWSER DEEPSEEK_BASE_URL DEEPSEEK_SEARCH_BASE_URL SSL_CERT_FILE SSL_CERT_DIR HTTP_PROXY HTTPS_PROXY ALL_PROXY NO_PROXY REQUESTS_CA_BUNDLE CURL_CA_BUNDLE NODE_TLS_REJECT_UNAUTHORIZED').split(' '))
for(const name of ['PI_PACKAGE_DIR','PI_CODING_AGENT_DIR','PI_CODING_AGENT_SESSION_DIR','PI_SELF_UPDATE_COMMAND','PI_MANAGED_INSTALL_ROOT','PI_INSTALLER_API_BASE','PI_SHARE_VIEWER_URL','PI_TELEMETRY','PI_OFFLINE'])bootstrap.add(name)
const prefixes=['NIGHT_BOT_','DSH_','XDG_','DYLD_','BASH_FUNC_'],homeProxy=new Set(['HTTP_PROXY','HTTPS_PROXY','ALL_PROXY','NO_PROXY'])
const key=name=>process.platform==='win32'?name.toUpperCase():name
export function resolveLegacyHome(configured,env=process.env){const raw=configured??(env.DSH_HOME?.trim()?env.DSH_HOME:join(homedir(),'.dsh'));return resolve(raw==='~'?homedir():raw.startsWith('~/')||raw.startsWith('~\\')?join(homedir(),raw.slice(2)):raw)}
export function createLaunchEnvironmentSnapshot(layers){const sources=new Map(layers.map(layer=>[layer.source,{path:layer.path,values:new Map(Object.entries(layer.values).map(([name,value])=>[key(name),value]))}]));const getFrom=(name,selected)=>{for(const source of order){if(!selected.includes(source))continue;const layer=sources.get(source),value=layer?.values.get(key(name));if(value!==undefined)return{value,source,...layer.path===undefined?{}:{path:layer.path}}}};return Object.freeze({get:name=>getFrom(name,order),getFrom})}
export const launchEnvironmentOf=ctx=>ctx.get('launchEnvironment')??createLaunchEnvironmentSnapshot([{source:'process',values:process.env}])
export async function loadNativeEnvironment({cwd=process.cwd(),home,inherited={...process.env},warn=()=>{},materialize=false}={}){
 home=home===undefined?undefined:resolve(home);cwd=resolve(cwd)
 async function layer(directory,source){const path=join(directory,'.env');let text;try{text=await readFile(path,'utf8')}catch(error){if(error.code!=='ENOENT')warn('Environment file could not be read: '+path);return}const values=parseEnv(text);for(const name of Object.keys(values)){const upper=name.toUpperCase();if((bootstrap.has(upper)||prefixes.some(p=>upper.startsWith(p)))&&!(directory===home&&homeProxy.has(upper)))throw new Error('NIGHT_BOT_BOOTSTRAP_ENV_REFUSED:'+name)}return{source,path,values}}
 // Validate both files before touching the child launch environment.
 const project=await layer(cwd,'project-env'),user=home===undefined||home===cwd?undefined:await layer(home,'user-env'),layers=[{source:'process',values:inherited},...project?[project]:[],...user?[user]:[]]
 if(materialize)for(const entry of [project,user])if(entry)for(const [name,value]of Object.entries(entry.values)){const present=process.platform==='win32'?Object.keys(process.env).some(existing=>key(existing)===key(name)):process.env[name]!==undefined;if(!present)process.env[name]=value}
 return createLaunchEnvironmentSnapshot(layers)
}
