import test from 'node:test'
import assert from 'node:assert/strict'
import {topicRouteSubmissionSchema,topicRouteSubmissionJsonSchema} from '../packages/dingtalk-core/decision.js'
import {assertSupportedJsonSchema,validateJsonSchemaValue} from '../src/native-tool-protocol.js'
test('published topic routing input accepts same-domain fixed categories and omitted default arrays',()=>{
 assertSupportedJsonSchema(topicRouteSubmissionJsonSchema)
 for(const fixedTopic of ['agent-platform','out-of-scope']){
  const value={requestId:'request',routes:[{messageId:'message',messageVersion:1,units:[{unitKey:'unit',summary:'fixed question',sourceRefs:[{quote:'source'}],topics:[],fixedTopic,...fixedTopic==='out-of-scope'?{outOfScopeHelp:true}:{},reason:'fixed category'}]}]}
  assert.equal(topicRouteSubmissionSchema.safeParse(value).success,true);assert.deepEqual(validateJsonSchemaValue(topicRouteSubmissionJsonSchema,value),[])
  const parsed=topicRouteSubmissionSchema.parse(value);assert.deepEqual(parsed.routes[0].units[0].replacesUnitIds,[]);assert.deepEqual(parsed.routes[0].units[0].contextRefs,[])
 }
})
test('published routing input keeps strict unknown properties and domain effect-ownership checks',()=>{
 const invalid={requestId:'request',routes:[{messageId:'message',messageVersion:1,units:[{unitKey:'unit',summary:'question',sourceRefs:[{quote:'source'}],topics:[],fixedTopic:'out-of-scope',outOfScopeHelp:true,reason:'fixed category',unexpected:'value'}]}]}
 assert.equal(topicRouteSubmissionSchema.safeParse(invalid).success,false);assert.ok(validateJsonSchemaValue(topicRouteSubmissionJsonSchema,invalid).length)
 delete invalid.routes[0].units[0].unexpected;invalid.routes[0].units[0].effectOwner={topicId:'foreign-topic'};assert.equal(topicRouteSubmissionSchema.safeParse(invalid).success,false)
})
