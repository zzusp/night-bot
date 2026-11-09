import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import test from 'node:test'
import { createServer } from 'node:http'
import { handleRequest } from '../packages/dingtalk-core/http.js'
import { buildTaskAssociationIndex } from '../packages/dingtalk-core/runtime.js'

test('通用生产源码不绑定个人姓名，群回复署名遵循工作区与群职责', async () => {
  const source = await readFile(new URL('../packages/dingtalk-dsh-assistant/runtime.js', import.meta.url), 'utf8')
  assert.doesNotMatch(source, /小小鹏|孙鹏/u)
  const root=new URL('../packages/',import.meta.url)
  const files=await readdir(root,{recursive:true})
  for(const file of files.filter(name=>name.endsWith('.js'))){
    const body = await readFile(new URL(file.replaceAll('\\','/'),root),'utf8')
    assert.doesNotMatch(body, /孙鹏/u, file)
    assert.doesNotMatch(body, /小小鹏/u, file)
  }
})

test('生产HTTP提供精确的单消息重试入口', async () => {
  const calls = []
  const server = createServer((request, response) => handleRequest(request, response, {
    retryDecisionFailedMessage: async value => { calls.push(value); return { retried: true } },
  }, { testApiEnabled: false }))
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  try {
    const input = { messageVersion: 2, activeUnitRefs: [{ unitId: 'unit', unitRevision: 1 }], phase: 'decision', requestId: 'request', token: 'a'.repeat(64) }
    const response = await fetch(`http://127.0.0.1:${server.address().port}/config/groups/group/messages/message/retry`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input),
    })
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), { retried: true })
    assert.deepEqual(calls, [{ ...input, groupId: 'group', messageId: 'message' }])
  } finally { await new Promise(resolve => server.close(resolve)) }
})

test('retired Owner and subagent session drivers are absent from the metadata module', async () => {
  const api = await import('../packages/dingtalk-core/runtime.js')
  assert.deepEqual(Object.keys(api).sort(), ['buildTaskAssociationIndex','residentSessionId','taskWorkLocations'])
})

test('Task上下文只引用固定Topic版本，不再构造消息正文持久副本', async () => {
  const refs = [{ topicId: 'topic-1', revision: 2 }]
  const [item] = buildTaskAssociationIndex([{ taskId: 'task-1', title: '执行任务', objective: '导出数据', state: 'running', topicRefs: refs, inputVersion: 3, runSequence: 1, messageHistory: [{ text: '历史原文不得重复注入' }] }])
  assert.deepEqual(item.topicRefs, refs)
  assert.equal(item.inputVersion, 3)
  assert.equal(item.messageHistory, undefined)
  assert.equal(item.sourceMessageId, undefined)
})
