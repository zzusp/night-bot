import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,mkdir,writeFile,rm,readFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {pathToFileURL} from 'node:url'
import {evaluatePluginCompatibility,prepareProfileEntries} from '../src/native-profile-preflight.js'
const fresh=async t=>{const root=await mkdtemp(join(tmpdir(),'night-preflight-'));t.after(()=>rm(root,{recursive:true,force:true}));return root}
test('every DSH peer is unsupported, regardless of matching historical version or wildcard',()=>{
 for(const name of ['@deepseek-ai/dsh','@deepseek-ai/dsh-tools'])for(const range of ['*','0.2.1-alpha.2','workspace:*','^999'])assert.deepEqual(evaluatePluginCompatibility({name:'fixture',peerDependencies:{[name]:range}}).peers,{[name]:range})
 assert.equal(evaluatePluginCompatibility({peerDependencies:{'@earendil-works/pi-agent-core':'1.5.0'}}),undefined)
 assert.deepEqual(evaluatePluginCompatibility({name:'@deepseek-ai/dsh-fs-local'}).peers,{'@deepseek-ai/dsh-fs-local':'unsupported package'})
 for(const peerDependencies of [null,[],{x:12}])assert.throws(()=>evaluatePluginCompatibility({peerDependencies}))
 assert.equal(evaluatePluginCompatibility(Object.create({peerDependencies:{'@deepseek-ai/dsh':'*'}})),undefined)
})
test('DSH plugin code is never evaluated and historical exemptions do not authorize its ABI',async t=>{
 const root=await fresh(t);await mkdir(join(root,'plugin'))
 await writeFile(join(root,'plugin/package.json'),JSON.stringify({name:'fixture',version:'1.0.0',peerDependencies:{'@deepseek-ai/dsh':'*'}}))
 await writeFile(join(root,'plugin/index.js'),'throw new Error("plugin must not evaluate")')
 await writeFile(join(root,'compatibility.json'),JSON.stringify({'fixture@1.0.0':['0.2.1-alpha.2']}))
 const name=pathToFileURL(join(root,'plugin/index.js')).href,base=pathToFileURL(join(root,'root.yml')).href,ctx={get:name=>name==='profileContext'?{dir:root}:undefined,logger:{warn(){}}},rows=[{name}]
 const result=prepareProfileEntries(ctx,rows,base)
 assert.equal(result[0].disabled,true);assert.equal(prepareProfileEntries({get:()=>undefined,logger:{warn(){}}},rows,base)[0].disabled,true);assert.equal(rows[0].disabled,undefined)
 assert.equal(await readFile(join(root,'plugin/index.js'),'utf8'),'throw new Error("plugin must not evaluate")')
 assert.equal(prepareProfileEntries(ctx,[{name:'cordis:group',group:true,config:rows}],base)[0].config[0].disabled,true)
 await writeFile(join(root,'nested.json'),JSON.stringify(rows))
 assert.equal(prepareProfileEntries(ctx,[{name:'cordis:include',config:{path:'nested.json'}}],base)[0].disabled,true)
 await writeFile(join(root,'nested.json'),JSON.stringify([{id:'target',name:'cordis:group',group:true,config:[]}]))
 assert.equal(prepareProfileEntries(ctx,[{name:'cordis:include',config:{path:'nested.json',patches:[{id:'target',insert:rows}]}}],base)[0].disabled,true)
})
test('ordinary trusted application plugins and detached profile rows remain available',async t=>{
 const root=await fresh(t);await mkdir(join(root,'plugin'))
 await writeFile(join(root,'plugin/package.json'),JSON.stringify({name:'fixture',version:'1.0.0'}));await writeFile(join(root,'plugin/index.js'),'export default {}')
 const rows=[{name:pathToFileURL(join(root,'plugin/index.js')).href}],ctx={get:name=>name==='profileContext'?{dir:root}:undefined,logger:{warn(){}}},base=pathToFileURL(join(root,'root.yml')).href
 assert.deepEqual(prepareProfileEntries(ctx,rows,base),rows)
 const detached=prepareProfileEntries({get:()=>undefined,logger:{warn(){}}},rows,base);detached[0].disabled=true;assert.equal(rows[0].disabled,undefined)
})
test('unreadable and recursive includes preserve loader diagnostics without rewriting files',async t=>{
 const root=await fresh(t),base=pathToFileURL(join(root,'root.yml')).href,ctx={get:name=>name==='profileContext'?{dir:root}:undefined,logger:{warn(){}}}
 const rows=[{name:'cordis:include',config:{path:'missing.yml'}}];assert.deepEqual(prepareProfileEntries(ctx,rows,base),rows)
 await writeFile(join(root,'loop.json'),JSON.stringify([{name:'cordis:include',config:{path:'loop.json'}}]))
 assert.equal(prepareProfileEntries(ctx,[{name:'cordis:include',config:{path:'loop.json'}}],base)[0].disabled,undefined)
 assert.throws(()=>prepareProfileEntries(ctx,[],undefined),/resolution base/)
})

test('actual default Host rejects a DSH plugin before module evaluation',async t=>{
 const {createHost}=await import('../src/host.js')
 const root=await fresh(t);await mkdir(join(root,'plugin'))
 await writeFile(join(root,'plugin/package.json'),JSON.stringify({name:'@deepseek-ai/dsh-fixture',version:'1.0.0',type:'module'}))
 const marker=join(root,'evaluated.txt'),entry=join(root,'plugin/index.js')
 await writeFile(entry,`import {writeFileSync} from 'node:fs';writeFileSync(${JSON.stringify(marker)},'unsafe');export function apply(){throw Error('must not load')}`)
 const host=await createHost({installRoot:root,model:{provider:'fixture',model:'fixture'},plugins:[{name:pathToFileURL(entry).href}],credentialsWatch:false,skillWatch:false})
 try{await assert.rejects(readFile(marker),{code:'ENOENT'});assert.ok(host.ctx.get('agentLoop'))}finally{await host.close()}
})
