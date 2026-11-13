import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,writeFile,rename,symlink,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import PiPersistence from '../src/pi-session-persistence.js'

test('native live digest checks current bytes and inode, rejects symlinks and shares only in-flight reads',async t=>{
 const root=await mkdtemp(join(tmpdir(),'night-live-digest-'));t.after(()=>rm(root,{recursive:true,force:true}))
 const persistence=Object.create(PiPersistence.prototype)
 persistence.config={root};persistence.closed=false;persistence.digestReads=new Map()
 const path=persistence.path('session-one');await writeFile(path,'safe synthetic bytes')
 const first=await persistence.readNativeDigest('session-one')
 assert.deepEqual(await Promise.all([persistence.readNativeDigest('session-one'),persistence.readNativeDigest('session-one')]),[first,first]);assert.equal(persistence.digestReads.size,0)
 await writeFile(path+'.new','safe synthetic bytes');await rename(path+'.new',path)
 assert.notEqual(await persistence.readNativeDigest('session-one'),first,'same bytes on a replaced inode cannot reuse proof')
 await writeFile(path,'changed bytes');const changed=await persistence.readNativeDigest('session-one');assert.notEqual(changed,first)
 await rename(path,path+'.real');await symlink(path+'.real',path)
 await assert.rejects(persistence.readNativeDigest('session-one'),{code:'PI_SESSION_PATH_UNSAFE'})
})

test('native digest rejects append or replacement before readback completes and permits a fresh retry',async t=>{
 const root=await mkdtemp(join(tmpdir(),'night-live-changing-'));t.after(()=>rm(root,{recursive:true,force:true}))
 const persistence=Object.create(PiPersistence.prototype)
 persistence.config={root};persistence.closed=false;persistence.digestReads=new Map()
 const path=persistence.path('session-changing');await writeFile(path,'synthetic journal')
 const check=PiPersistence.prototype.checkedFile.bind(persistence)
 let checks=0
 persistence.checkedFile=async(...args)=>{if(++checks===2)await writeFile(path,'changed during validation');return check(...args)}
 await assert.rejects(persistence.readNativeDigest('session-changing'),{code:'PI_SESSION_CHANGED'})
 assert.equal(persistence.digestReads.size,0)
 persistence.checkedFile=check
 assert.equal(typeof await persistence.readNativeDigest('session-changing'),'string')
})
