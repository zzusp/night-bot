import {Service} from '@deepseek-ai/cordis'
import {createRequire} from 'node:module'
// Proxy policy remains shared with installed capabilities until that seam moves.
import {proxyEnvironmentForChild} from '@deepseek-ai/dsh-http-proxy'
export const MAX_TIMER_DELAY_MS=2147483647
export class SubprocessRuntime extends Service{constructor(ctx){super(ctx,'subprocess')}}
export class SubprocessExecutableNotFoundError extends Error{constructor(message,options){super(message,options);this.name='SubprocessExecutableNotFoundError'}}
export function createLazyRequire(specifier,parent){const require=createRequire(parent);let ready=false,value;return()=>{if(!ready){value=require(specifier);ready=true}return value}}
export function scrubbedParentEnv(){const env={};for(const [key,value]of Object.entries(process.env))if(value!==undefined&&!/KEY|PASSWORD|SECRET|TOKEN/i.test(key)&&!key.toUpperCase().startsWith('DSH_'))env[key]=value;for(const [key,value]of Object.entries(proxyEnvironmentForChild()))if(value===undefined)delete env[key];else env[key]=value;return env}
