import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,mkdir,rm,writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {loadNativeEnvironment,createLaunchEnvironmentSnapshot} from '../src/native-environment.js'
test('native environment snapshot preserves source ordering and immutable launch-time values',()=>{const layers=[{source:'user-env',path:'/u',values:{A:'user',B:'user'}},{source:'project-env',path:'/p',values:{A:'project',C:'project'}},{source:'process',values:{A:'inherited'}}],native=createLaunchEnvironmentSnapshot(layers);for(const [name,value]of Object.entries({A:'inherited',B:'user',C:'project'}))assert.equal(native.get(name).value,value);assert.equal(native.get('none'),undefined);assert.equal(native.getFrom('A',['project-env','user-env']).value,'project');layers[2].values.A='changed';assert.equal(native.get('A').value,'inherited')})
test('environment lookup keeps provenance, explicit empty values and selected-source precedence',()=>{
 const snapshot=createLaunchEnvironmentSnapshot([{source:'user-env',path:'/user',values:{A:'user',EMPTY:'fallback'}},{source:'project-env',path:'/project',values:{A:'project'}},{source:'process',values:{A:'process',EMPTY:''}}])
 assert.deepEqual(snapshot.get('A'),{value:'process',source:'process'})
 assert.deepEqual(snapshot.getFrom('A',['user-env','project-env']),{value:'project',source:'project-env',path:'/project'})
 assert.deepEqual(snapshot.get('EMPTY'),{value:'',source:'process'})
 assert.equal(snapshot.getFrom('A',[]),undefined)
 assert.deepEqual(snapshot.entriesFrom(['process']),{A:'process',EMPTY:''})
 assert.deepEqual(snapshot.entriesFrom(['user-env','project-env']),{A:'project',EMPTY:'fallback'})
 const copy=snapshot.entriesFrom(['process']);copy.A='mutated';assert.equal(snapshot.get('A').value,'process')
 assert.deepEqual(snapshot.entriesFrom([]),{})
})
async function files(t){const root=await mkdtemp(join(tmpdir(),'night-env-')),cwd=join(root,'project'),home=join(root,'home');await mkdir(cwd);await mkdir(home);t.after(()=>rm(root,{recursive:true,force:true}));return{root,cwd,home}}
test('native dotenv layers preserve credential precedence without materializing secrets in embedding mode',async t=>{const {cwd,home}=await files(t);await writeFile(join(cwd,'.env'),'NIGHT_ENV_FIXTURE_SECRET=project\nPROJECT_ONLY=project\n');await writeFile(join(home,'.env'),'NIGHT_ENV_FIXTURE_SECRET=home\nUSER_ONLY=user\n');const env=await loadNativeEnvironment({cwd,home,inherited:{NIGHT_ENV_FIXTURE_SECRET:'inherited'}});assert.equal(env.get('NIGHT_ENV_FIXTURE_SECRET').value,'inherited');assert.equal(env.getFrom('NIGHT_ENV_FIXTURE_SECRET',['project-env','user-env']).value,'project');assert.equal(env.get('USER_ONLY').source,'user-env');assert.equal(process.env.NIGHT_ENV_FIXTURE_SECRET,undefined)})
test('dotenv bootstrap guards reject repository proxy and home CA changes before applying either layer',async t=>{const {cwd,home}=await files(t);await writeFile(join(cwd,'.env'),'NIGHT_ENV_UNAPPLIED=fixture\n');await writeFile(join(home,'.env'),'NODE_EXTRA_CA_CERTS=/untrusted\n');await assert.rejects(loadNativeEnvironment({cwd,home,inherited:{},materialize:true}),/BOOTSTRAP_ENV_REFUSED/);assert.equal(process.env.NIGHT_ENV_UNAPPLIED,undefined);await writeFile(join(home,'.env'),'HTTPS_PROXY=http://operator.invalid\n');const safe=await loadNativeEnvironment({cwd,home,inherited:{}});assert.equal(safe.get('HTTPS_PROXY').source,'user-env');await writeFile(join(cwd,'.env'),'https_proxy=http://repository.invalid\n');await assert.rejects(loadNativeEnvironment({cwd,home,inherited:{}}),/BOOTSTRAP_ENV_REFUSED/)})

test('omitting a user directory never reads DSH_HOME dotenv and keeps repository bootstrap rejection',async t=>{
 const {cwd,home}=await files(t),saved=process.env.DSH_HOME
 t.after(()=>{if(saved===undefined)delete process.env.DSH_HOME;else process.env.DSH_HOME=saved})
 process.env.DSH_HOME=home
 await writeFile(join(cwd,'.env'),'PROJECT_PROOF=local\n')
 await writeFile(join(home,'.env'),'EXTERNAL_HOME_PROOF=must-not-load\n')
 const snapshot=await loadNativeEnvironment({cwd,inherited:{}})
 assert.equal(snapshot.get('PROJECT_PROOF').value,'local')
 assert.equal(snapshot.get('EXTERNAL_HOME_PROOF'),undefined)
 await writeFile(join(cwd,'.env'),'HTTPS_PROXY=http://untrusted.invalid\n')
 await assert.rejects(loadNativeEnvironment({cwd,inherited:{}}),/BOOTSTRAP_ENV_REFUSED/)
 const explicit=await loadNativeEnvironment({cwd:home,home,inherited:{}})
 assert.equal(explicit.get('EXTERNAL_HOME_PROOF').value,'must-not-load')
})
