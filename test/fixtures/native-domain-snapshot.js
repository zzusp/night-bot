import {mkdtemp,writeFile,rm} from 'node:fs/promises'
import {readFileSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {openNativeDomains} from '../../src/native-domain.js'
import {residentDomainSpec,performanceDomainSpec} from '../../packages/dingtalk-core/store.js'

// An explicit offline snapshot fixture, not a storage implementation. All live
// reads, writes, serialization, commit and rollback run in openNativeDomains.
// Existing corruption/recovery cases edit this detached committed document and
// seed a NEW directory; native schema validation still decides whether it opens.
export async function nativeResidentSnapshot(snapshot={tables:{},global:null},{beforeCommit}={}){
 const root=await mkdtemp(join(tmpdir(),'night-domain-snapshot-'))
 const file=join(root,residentDomainSpec.name+'.json')
 await writeFile(file,JSON.stringify({unit:{name:residentDomainSpec.name,version:residentDomainSpec.version},...structuredClone(snapshot)}),{mode:0o600})
 const diagnosticFile=join(root,performanceDomainSpec.name+'.json')
 if(snapshot.diagnostics)await writeFile(diagnosticFile,JSON.stringify({unit:{name:performanceDomainSpec.name,version:performanceDomainSpec.version},...snapshot.diagnostics}),{mode:0o600})
 let pending=0,commits=0
 const domains=await openNativeDomains({root,async beforeCommit(event){await beforeCommit?.(event);pending++},onChange(event){
  pending--;commits++
  const saved=JSON.parse(readFileSync(event.domain===performanceDomainSpec.name?diagnosticFile:file,'utf8'))
  if(event.domain===performanceDomainSpec.name)snapshot.diagnostics={tables:saved.tables,global:saved.global}
  else{snapshot.tables=saved.tables;snapshot.global=saved.global}
 }})
 return {domains,snapshot,root,async settle(){
  const deadline=Date.now()+3000
  let stable=0,previous=-1
  while(stable<2){
   if(Date.now()>deadline)throw new Error('NATIVE_TEST_DOMAIN_COMMIT_TIMEOUT')
   await new Promise(resolve=>setTimeout(resolve,5))
   stable=pending===0&&commits===previous?stable+1:0;previous=commits
  }
 },async close(){await domains.closeAll();await rm(root,{recursive:true,force:true})}}
}
