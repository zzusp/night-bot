import test from 'node:test'
import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {collectSourceEvidence} from '../scripts/release-artifacts.mjs'
import {readFile} from 'node:fs/promises'
import {verifyOfficialPi} from '../scripts/verify-native-test-profile.mjs'

test('installed locked Pi 1.5 exposes the public session, projection and tool APIs',async()=>{
 assert.deepEqual(await verifyOfficialPi(),{'@earendil-works/pi-ai':'1.5.0','@earendil-works/pi-agent-core':'1.5.0','@earendil-works/pi-coding-agent':'1.5.0'})
})
test('public Pi verification rejects missing, floating and changed dependency pins',async()=>{
 const original=JSON.parse(await readFile(new URL('../package.json',import.meta.url),'utf8'))
 for(const name of ['@earendil-works/pi-ai','@earendil-works/pi-agent-core','@earendil-works/pi-coding-agent'])for(const pin of [undefined,'^1.5.0','1.5.1']){
  const manifest=structuredClone(original);if(pin===undefined)delete manifest.dependencies[name];else manifest.dependencies[name]=pin
  await assert.rejects(verifyOfficialPi(manifest),/Pi must remain exactly pinned/)
 }
})

test('release evidence binds actual lock, retained profile and installed Pi versions',async()=>{
 const evidence=await collectSourceEvidence(),hash=bytes=>createHash('sha256').update(bytes).digest('hex')
 assert.deepEqual(Object.keys(evidence).sort(),['lockSha256','piVersions','profileSha256'])
 assert.equal(evidence.lockSha256,hash(await readFile(new URL('../pnpm-lock.yaml',import.meta.url))))
 assert.equal(evidence.profileSha256,hash(await readFile(new URL('./fixtures/native-profile/package.json',import.meta.url))))
 assert.deepEqual(evidence.piVersions,await verifyOfficialPi())
})
