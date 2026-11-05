import {Service} from '@deepseek-ai/cordis'
import {createRequire} from 'node:module'
// One application policy owns public HTTP routing and ordinary child proxy overlays.
import {proxyEnvironmentForChild} from '../native-http-proxy.js'
export const MAX_TIMER_DELAY_MS=2147483647
export class SubprocessRuntime extends Service{constructor(ctx){super(ctx,'subprocess')}}
export class SubprocessExecutableNotFoundError extends Error{constructor(message,options){super(message,options);this.name='SubprocessExecutableNotFoundError'}}
export function createLazyRequire(specifier,parent){const require=createRequire(parent);let ready=false,value;return()=>{if(!ready){value=require(specifier);ready=true}return value}}
export function scrubbedParentEnv(){const env={};for(const [key,value]of Object.entries(process.env))if(value!==undefined&&!/KEY|PASSWORD|SECRET|TOKEN/i.test(key)&&!/^(?:DSH_|NIGHT_BOT_)/i.test(key))env[key]=value;for(const [key,value]of Object.entries(proxyEnvironmentForChild()))if(value===undefined)delete env[key];else env[key]=value;return env}
