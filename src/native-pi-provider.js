import z from '@deepseek-ai/schemastery'
import {OfficialPiModelRuntime} from './pi-official-model-runtime.js'
import {NativeModelRoutes} from './native-model-routes.js'
import {launchEnvironmentOf} from './native-environment.js'
import {resolvePiProfiles} from './pi-provider-catalog.js'
import {piAuthentication} from './pi-provider-auth.js'
import {registerPiLoginFlows} from './pi-provider-login.js'

export const name='night-native-pi-provider'
export const Config=z.object({providers:z.dict(z.any()).default({}).volatile()})
/** Application configuration/authentication around Pi's official ModelRuntime.
 * No alternate stream protocol, generic LLM adapter or message conversion. */
export function apply(ctx,config){
 const settingsNs=ctx.fiber.entry?.options.id??name
 ctx.inject(['settings'],child=>child.effect(()=>child.settings.configure({auto:false},ctx.fiber)))
 const authentication=piAuthentication({getCredentials:()=>ctx.get('credentials'),getEnvironment:key=>launchEnvironmentOf(ctx).get(key)?.value})
 let last,profiles
 const current=()=>{const raw=config.providers.get();if(raw!==last){profiles=resolvePiProfiles(raw,{deferred:true});last=raw}return profiles}
 current()
 const official=new OfficialPiModelRuntime(ctx,current,authentication)
 ctx.provide('nativePiProvider',Object.freeze({profiles:current,official}))
 ctx.provide('nativeModelRoutes',new NativeModelRoutes({profiles:current,official,authentication,settingsNs}))
 ctx.inject(['authorization'],child=>registerPiLoginFlows(child,authentication))
 ctx.on('loader/volatile-update',()=>{try{current()}catch(error){ctx.logger.error(error)}})
 ctx.on('internal/config',function(_raw,next){const raw=next();if(this===ctx.fiber){const candidate=Config(raw),before=config.providers.get(),changed=Object.fromEntries(Object.entries(candidate.providers.get()).filter(([id,value])=>JSON.stringify(value)!==JSON.stringify(before[id])));resolvePiProfiles(changed)}return raw})
}
