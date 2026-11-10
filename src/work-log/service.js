import {Service} from '@deepseek-ai/cordis'
import {resolveWorkLogConfig} from './config.js'
import {DailyWorkLog} from './runner.js'
import {collectWorkLogEvidence} from './evidence.js'
import {summarizeWorkLog} from './summary.js'
import {workLogSecrets} from './redaction.js'

/** Private operator-owned diary. No message delivery, model tools, business
 * mutation, credential export or additional task is created by this service. */
export default class WorkLog extends Service {
 static inject=['runtimePaths','sessionPersistence','schedule','credentials']
 constructor(ctx,config={}){
  super(ctx,'workLog');this.host=ctx;this.config=resolveWorkLogConfig(config,{env:ctx.get('launchEnvironment')??process.env});this.runner=null;this.closed=false;this.abort=new AbortController()
  ctx.on('night/ready',application=>this.attach(application))
  ctx.on('night/stopping',()=>this.close())
  ctx.effect(()=>()=>this.close(),'daily work log drain')
  this.fullConfig=config
 }
 async attach(application){
  if(this.closed||this.runner)return
  this.runner=new DailyWorkLog({paths:this.host.runtimePaths,config:this.config,
   collect:async options=>{
    const evidence=await collectWorkLogEvidence({...options,store:application.tasks.store,persistence:this.host.sessionPersistence,schedule:this.host.schedule})
    if(evidence.active){
     const secrets=await workLogSecrets(this.fullConfig,this.host.credentials,this.host.get('launchEnvironment'))
     evidence.summary=await summarizeWorkLog({...options,evidence,secrets,signal:AbortSignal.any([this.abort.signal,AbortSignal.timeout(30000)]),resolve:signal=>{
      const official=this.host.get('nativePiProvider')?.official
      if(!official?.resolve)throw new Error('WORK_LOG_MODEL_UNAVAILABLE')
      return official.resolve({...this.fullConfig.model,signal})
     }})
    }
    return evidence
   },
   secrets:()=>workLogSecrets(this.fullConfig,this.host.credentials,this.host.get('launchEnvironment')),
   onError:code=>this.host.logger.warn('daily work log: '+code)})
  await this.runner.start()
 }
 async close(){this.closed=true;this.abort.abort();await this.runner?.close()}
}
