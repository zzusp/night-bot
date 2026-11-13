import test from 'node:test'
import assert from 'node:assert/strict'
import {registerResidentRouterTools} from '../src/channels/resident-router-business.js'
import {officialToolsFixture} from './fixtures/pi-official-tools.js'
import {createScope} from '../src/native-scope.js'

test('Router exposes list/update/delete with bound conversation, source and generation',async t=>{
  const calls=[],state={generation:2,phase:'active'},original={sourceId:'s',groupId:'g',messageId:'m',version:1,actorId:'a',channel:'chat'}
  let scope
  const f=await officialToolsFixture(t,({ctx,owner})=>{
    scope=createScope(ctx,owner);owner.ctx=scope.ctx
    return registerResidentRouterTools(scope.ctx,{conversationId:'g',generation:2,sessionId:owner.id},{responsibilityFor:()=>'',
      query:async(kind,args)=>kind==='router.get'?state:kind==='source.get'?{...original,...(args.sourceId==='foreign'?{groupId:'foreign'}:{})}:kind==='source.list'?[original]:[],
      platformScheduleList:async id=>{calls.push(['list',id]);return []},
      platformScheduleUpdate:async args=>{calls.push(['update',args]);return {status:'scheduled',scheduleId:'new'}},
      platformScheduleDelete:async args=>{calls.push(['delete',args]);return {status:'cancelled'}}})
  })
  f.deferCleanup(()=>scope.dispose())
  const tool=name=>f.ctx.tools.get('platform_schedule_'+name,f.owner),exec={agent:f.owner}
  assert.deepEqual(await tool('list').execute({},exec),[])
  assert.equal((await tool('update').execute({operationId:'edit',sourceId:'s',messageVersion:1,scheduleId:'old',change:{at:'2026-11-14T05:00:00+08:00'}},exec)).scheduleId,'new')
  assert.equal(calls[1][1].conversationId,'g');assert.deepEqual(calls[1][1].source,original)
  assert.equal((await tool('delete').execute({operationId:'delete',sourceId:'s',messageVersion:1,scheduleId:'new'},exec)).status,'cancelled')
  await assert.rejects(tool('delete').execute({operationId:'x',sourceId:'foreign',messageVersion:1,scheduleId:'old'},exec),/SOURCE_FORBIDDEN/)
  state.generation=3
  await assert.rejects(tool('list').execute({},exec),/GENERATION_STALE/)
  assert.equal(calls.length,3)
})
