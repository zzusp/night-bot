import assert from 'node:assert/strict'
import test from 'node:test'
import {toolDetailNotice as notice} from '../src/tool-detail-state.ts'
const dto = (text, extra={}) => ({text,...extra})

test('tool absence is separate from restriction and from an active or split call', () => {
  assert.equal(notice('input',dto('{}')), '无需参数。')
  assert.equal(notice('input',dto('{}',{redacted:true})), '参数未公开。')
  assert.equal(notice('input',dto('该工具的参数未公开。',{redacted:true,detailState:'withheld'})), '参数未公开。')
  assert.equal(notice('input',dto('没有其他详情。',{detailState:'empty'})), '无需参数。')
  assert.equal(notice('output',dto('工具已返回，未包含文字正文。',{detailState:'empty'})), '已返回，无文字输出。')
  assert.equal(notice('output',dto('工具已返回，未包含文字正文。',{detailState:'withheld',redacted:true})), '结果未公开。')
  assert.equal(notice('output',dto('',{detailState:'not-recorded'})), '未记录工具结果。')
  assert.equal(notice('output',undefined,{elsewhere:true}), '见下方结果。')
  assert.equal(notice('output',undefined,{running:true}), '等待工具返回。')
  assert.equal(notice('output'), '未记录工具结果。')
  assert.equal(notice('input'), '未记录输入参数。')
  assert.equal(notice('input',undefined,{elsewhere:true}), '输入见上方调用。')
})
test('authorized exact fragments, independent resources and genuine failures are not suppressed', () => {
  assert.equal(notice('input',dto('{}',{textNextOffset:2,redacted:true,detailState:'withheld'})),null)
  assert.equal(notice('output',dto('',{textTotal:20,truncated:true,status:'error'})),null)
  assert.equal(notice('output',dto('已获权的一部分。',{redacted:true,detailState:'withheld'})),null)
  assert.equal(notice('output',dto('{}')),null)
  assert.equal(notice('output',dto('此工具尚未声明可展示的结果字段；调用名称与状态保留。',{redacted:true,resourceContent:true})),null)
  assert.equal(notice('output',dto('',{status:'error',failure:{reason:'未获准',code:'DECLINED'}})),'未获准\n错误码：DECLINED')
  assert.equal(notice('output',dto('',{isError:true,detailState:'empty'})),'未记录失败原因')
  assert.equal(notice('output',dto('安全失败摘要',{isError:true,redacted:true})),null)
})
