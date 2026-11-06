import {mkdtemp,writeFile,rm} from 'node:fs/promises'
import {readFileSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {openNativeDomains} from '../../src/native-domain.js'
import {residentDomainSpec} from '../../packages/dingtalk-core/store.js'

// An explicit offline snapshot fixture, not a storage implementation. All live
// reads, writes, serialization, commit and rollback run in openNativeDomains.
// Existing corruption/recovery cases edit this detached committed document and
// seed a NEW directory; native schema validation still decides whether it opens.
export async function nativeResidentSnapshot(snapshot={tables:{},global:null}){
 const root=await mkdtemp(join(tmpdir(),'night-domain-snapshot-'))
 const file=join(root,residentDomainSpec.name+'.json')
 await writeFile(file,JSON.stringify({unit:{name:residentDomainSpec.name,version:residentDomainSpec.version},...structuredClone(snapshot)}),{mode:0o600})
 let pending=0,commits=0
 const domains=await openNativeDomains({root,beforeCommit(){pending++},onChange(){
  pending--;commits++
  const saved=JSON.parse(readFileSync(file,'utf8'))
  snapshot.tables=saved.tables;snapshot.global=saved.global
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
