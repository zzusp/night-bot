import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises'
import {join} from 'node:path'
import {openNativeDomains} from '../src/native-domain.js'
import {residentDomainSpec,openResidentStore} from '../packages/dingtalk-core/store.js'

test('Night resident v9 opens its own data and refuses predecessor versions without rewriting them',async t=>{
 const root=await mkdtemp('/tmp/night-resident-version-boundary-')
 t.after(()=>rm(root,{recursive:true,force:true}))
 const file=join(root,residentDomainSpec.name+'.json')
 assert.equal(residentDomainSpec.version,9)
 for(const version of [6,7,8]){
  const original=JSON.stringify({unit:{name:residentDomainSpec.name,version},global:null,tables:{}})+'\n'
  await writeFile(file,original)
  const domains=await openNativeDomains({root})
  try{await assert.rejects(openResidentStore(domains),{code:'version-mismatch'})}
  finally{await domains.closeAll()}
  assert.equal(await readFile(file,'utf8'),original)
 }
 await writeFile(file,JSON.stringify({unit:{name:residentDomainSpec.name,version:9},global:null,tables:{}}))
 let domains=await openNativeDomains({root}),store=await openResidentStore(domains)
 await store.subscribe({groupId:'current-night-group',responsibility:'preserve Night-owned records'})
 await store.close();await domains.closeAll()
 domains=await openNativeDomains({root});store=await openResidentStore(domains)
 try{assert.equal(store.getGroup('current-night-group').responsibility,'preserve Night-owned records')}
 finally{await store.close();await domains.closeAll()}
})
