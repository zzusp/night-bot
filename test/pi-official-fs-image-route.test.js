import test from 'node:test'
import assert from 'node:assert/strict'
import {writeFile} from 'node:fs/promises'
import {join} from 'node:path'
import sharp from 'sharp'
import {memoryHost} from './fixtures/memory-host.js'
const png=await sharp({create:{width:2,height:2,channels:4,background:'#159ddd'}}).png().toBuffer()
for(const image of [false,true])test('filesystem image capability follows actual official session model: '+image,async t=>{
 let first=true
 const f=await memoryHost(t,()=>first?(first=false,{tool:'read_image',args:{path:'pixel.png'}}):{text:'done'})
 if(image){await f.close();f.config.providers.fixture.models[0].input=['text','image'];await f.boot()}
 const h=await f.agent('image-route-'+image,{actorId:'alice'})
 await writeFile(join(f.host.ctx.runtimePaths.workspaces,'pixel.png'),png)
 // Forged legacy route/options cannot overrule the actual Pi session model.
 assert.equal(h.actor.session,undefined);assert.equal(h.session.model.input.includes('image'),image)
 await f.say(h.actor,'Read pixel.png as an image')
 const result=h.session.messages.find(message=>message.role==='toolResult')
 assert.ok(result)
 if(image){assert.notEqual(result.isError,true,JSON.stringify(result));assert.ok(result.content.some(part=>part.type==='image'))}
 else{assert.equal(result.isError,true);assert.match(JSON.stringify(result),/PI_FILE_MODEL_IMAGE_UNSUPPORTED|does not declare image input/)}
})
