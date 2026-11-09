import test from 'node:test'
import assert from 'node:assert/strict'
import {conversations, conversationMessages, recentConversations} from '../server/views.js'

test('channel display names, missing names and mixed recent pagination never use native IDs as names', async () => {
  const contexts = {
    room: {type:'chat-room',channelId:'adapter',conversationId:'native-secret-id',conversationName:'项目讨论',updatedAt:'2026-11-09T12:00:00Z',participants:{actor:'native-user'},participantNames:{actor:'成员姓名'}},
    missing: {type:'chat-room',channelId:'adapter',conversationId:'other-native-id',updatedAt:'2026-11-08T12:00:00Z'},
    web: {type:'chat',channelId:'web'},
  }
  const channels={groupContext:id=>contexts[id]}
  const app={tasks:{listObserverGroups:()=>[{groupId:'room',name:'native-secret-id'},{groupId:'missing',name:'other-native-id'},{groupId:'web',name:'Web duplicate'}],
    observerGroupPage:(_id,{collection})=>({items:collection==='messages'?[{messageId:'one',actorId:'actor',senderName:'native-user',text:'hello'}]:[],total:collection==='messages'?1:0,nextOffset:null,revision:'r1'})}}
  const ledger={chats:()=>({items:[{id:'web-id',title:'Web conversation',updatedAt:'2026-11-09T13:00:00Z'}],total:1})}
  assert.deepEqual(conversations(app,channels).items.slice(0,2).map(x=>x.name),['项目讨论','未命名群聊'])
  assert.deepEqual(recentConversations(app,channels,ledger,'web',{offset:0,limit:2}),{items:[{id:'web-id',title:'Web conversation',updatedAt:'2026-11-09T13:00:00Z',kind:'web'},{id:'room',title:'项目讨论',updatedAt:'2026-11-09T12:00:00Z',kind:'channel'}],total:3,nextOffset:2})
  assert.equal(recentConversations(app,channels,ledger,'web',{offset:2,limit:2}).items[0].id,'missing')
  const result=await conversationMessages(app,'room',{limit:50},channels)
  assert.equal(result.items[0].senderName,'成员姓名')
  contexts.room.conversationName=' native-secret-id '
  assert.equal(conversations(app,channels).items[0].name,'未命名群聊')
  for (const rawId of ['native-user','actor','native-secret-id','room','adapter']) {
    contexts.room.participantNames.actor=' '+rawId+' '
    assert.equal((await conversationMessages(app,'room',{limit:50},channels)).items[0].senderName,'渠道成员')
  }
  delete contexts.room.participantNames
  assert.equal((await conversationMessages(app,'room',{limit:50},channels)).items[0].senderName,'渠道成员')
})
