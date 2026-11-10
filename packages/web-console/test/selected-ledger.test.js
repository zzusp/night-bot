import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {openWebLedger} from '../server/ledger.js'

test('Web exact selection reaches older retained ledger rows and resolves replies only by delivery key',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'selected-ledger-'))
 const ledger=await openWebLedger(dir,{channelId:'web',senderId:'owner'})
 t.after(async()=>{ledger.close();await rm(dir,{recursive:true,force:true})})
 const conversationId=ledger.canonical()
 for(let i=0;i<600;i++)ledger.reserve({requestId:'request-'+i,conversationId,groupId:'group',text:'message '+i,senderId:'owner',channelId:'web'})
 assert.equal(ledger.chat(conversationId).messages.some(row=>row.id==='request-0'),false)
 assert.deepEqual(ledger.selected(conversationId,'request-0'),{role:'user',messageId:'request-0',messageVersion:1,text:'message 0'})
 const receipt=await ledger.transport('web','owner').send({type:'chat',channelId:'web',senderId:'owner',conversationId,deliveryKey:'exact-notification',text:'reply',replyToMessageId:'request-0'})
 assert.deepEqual(ledger.selected(conversationId,receipt.messageId),{role:'assistant',notificationId:'exact-notification'})
 assert.equal(ledger.selected('foreign',receipt.messageId),null)
 assert.equal(ledger.selected('foreign','request-0'),null)
 assert.equal(ledger.selected(conversationId,'missing'),null)
 // Collision is unavailable, rather than silently choosing the user or assistant.
 ledger.reserve({requestId:receipt.messageId,conversationId,groupId:'group',text:'collision',senderId:'owner',channelId:'web'})
 assert.equal(ledger.selected(conversationId,receipt.messageId),null)
})
