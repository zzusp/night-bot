import test from 'node:test'
import assert from 'node:assert/strict'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {fileURLToPath} from 'node:url'
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


test('retained private profile pins only the same official Pi versions as the application',async()=>{
 const profile=JSON.parse(await readFile(new URL('./fixtures/native-profile/package.json',import.meta.url),'utf8'))
 assert.equal(profile.name,'night-bot-official-pi-test-profile');assert.equal(profile.version,'0.0.0');assert.equal(profile.private,true)
 assert.deepEqual(Object.keys(profile).sort(),['dependencies','name','private','type','version'])
 const verified=await verifyOfficialPi(profile)
 assert.deepEqual(profile.dependencies,verified)
 assert.deepEqual(verified,await verifyOfficialPi())
 for(const name of Object.keys(profile.dependencies)){
  const changed=structuredClone(profile);changed.dependencies[name]='1.5.1'
  await assert.rejects(verifyOfficialPi(changed),/Pi must remain exactly pinned/)
 }
})

test('CLI verifies official Pi without resolving any DSH module or requiring a legacy profile environment',async()=>{
 const preload="import {registerHooks} from 'node:module';registerHooks({resolve(specifier,context,next){if(specifier.startsWith('@deepseek-ai/dsh-'))throw Error('Legacy DSH resolution forbidden: '+specifier);return next(specifier,context)}})"
 const {stdout,stderr}=await promisify(execFile)(process.execPath,['--import','data:text/javascript,'+encodeURIComponent(preload),fileURLToPath(new URL('../scripts/verify-native-test-profile.mjs',import.meta.url))],{env:{...process.env,DSH_NATIVE_TEST_PROFILE:'/nonexistent/retired-profile/package.json'},timeout:15000})
 assert.equal(stderr,'')
 const lines=stdout.trim().split('\n');assert.equal(lines.length,1)
 assert.deepEqual(JSON.parse(lines[0]),{officialPi:await verifyOfficialPi(),credentialsLoaded:false})
})
