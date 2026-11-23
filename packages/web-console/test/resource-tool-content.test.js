import test from 'node:test'
import assert from 'node:assert/strict'
import Reflection from '../../../src/memory/reflection.js'
import {memoryScope} from '../../../src/memory/scope.js'
import {renderSkillContent} from '../../../src/native-skill-protocol.js'
import {readResourceToolContents, resourceReadCandidate} from '../server/resource-tool-content.js'

test('learned skill grant requires current exact content, scope, signature, and active evidence', async () => {
  const binding = {actorId: 'real-operator'}, scope = memoryScope(binding)
  const key = 'approved-resource', name = 'learned-' + key
  const state = {skills: {[key]: {revision: 1, active: true, origin: 'task-reflection', applicability: 'Check evidence',
    steps: ['Confirm source', 'Check current facts'], supports: [{memoryKey: 'observed-verification'}]}}}
  let supports = [{key: 'observed-verification'}]
  const reflection = Object.assign(Object.create(Reflection.prototype), {state: async () => structuredClone(state), supportEntries: async () => supports})
  const value = {name, provider: 'learned', content: reflection.renderSkill(scope, key, state.skills[key])}
  const proof = value => {
    const content = [{type: 'text', text: renderSkillContent(value)}]
    const message = {role: 'toolResult', toolName: 'skill', toolCallId: 'call-one', isError: false, content,
      details: {nativeResult: {value, content, isError: false}, unexpected: 'PRIVATE_CHILD'}}
    return resourceReadCandidate('skill', {name}, message, {type: 'message', message})
  }
  const resolve = candidate => readResourceToolContents([{id: 'one', candidate}], {memory: {store: {root: '/test'}}, reflection, binding})
  const candidate = proof(value)
  assert.ok(candidate)
  assert.deepEqual([...await resolve(candidate)], [['one', '1. Confirm source\n2. Check current facts']])
  assert.equal((await resolve(proof({...value, content: value.content + 'FORGED_TAIL'}))).size, 0)
  assert.equal((await resolve(proof({...value, content: value.content.replace(scope.id, 'a'.repeat(64))}))).size, 0)
  assert.equal((await resolve(proof({...value, content: value.content.replace(/;key=.*$/m, '')}))).size, 0)
  supports = []
  assert.equal((await resolve(candidate)).size, 0)
  supports = [{key: 'observed-verification'}]
  state.skills[key].revision = 2
  assert.equal((await resolve(candidate)).size, 0)
  state.skills[key].revision = 1
  state.skills[key].active = false
  assert.equal((await resolve(candidate)).size, 0)
})
