import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {pathToFileURL} from 'node:url'
import {Context} from '@deepseek-ai/cordis'
import * as native from '../src/native-scope.js'
import * as legacy from './fixtures/legacy-scope.mjs'

function behavior(api) {
  const root={},child={},next={}
  const binding=api.bindScopeParent(child,root)
  assert.throws(()=>api.bindScopeParent(child,next))
  assert.throws(()=>api.bindScopeParent(root,child))
  assert.deepEqual(api.scopeChainOf(child),[child,root])
  const ctx=new Context(), scoped=api.createScope(ctx,child)
  assert.equal(api.scopeOf(scoped.ctx),child)
  const target=api.scopeTarget({},child)
  assert.equal(api.carrierKeyOf(target),child)
  assert.equal(api.isScopeCarrier({...target}),false)
  assert.equal(target[Context.filter](api.createScope(ctx,root).ctx),true)
  assert.equal(target[Context.filter](api.createScope(ctx,next).ctx),false)
  binding.rebind(next)
  assert.deepEqual(api.scopeChainOf(child),[child,next])
  assert.equal(target[Context.filter](api.createScope(ctx,root).ctx),false)
  const entries=new api.NamedEntries(()=>new Error('duplicate'))
  const undo=entries.insert('__proto__',1)
  assert.throws(()=>entries.insert('__proto__',2))
  const old=entries.values();undo();undo();entries.insert('__proto__',3)
  assert.equal(old.next().done,true)
  assert.equal(entries.get('__proto__'),3)
  return ctx.fiber.dispose()
}
test('Scope algorithms agree with independent original private-state implementation',async()=>{
  await behavior(native);await behavior(legacy)
})
