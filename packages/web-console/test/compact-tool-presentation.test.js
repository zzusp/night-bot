import test from 'node:test'
import assert from 'node:assert/strict'
import {compactToolPresentation} from '../src/compact-tool-presentation.ts'
import {specializedToolPresentation} from '../src/specialized-tool-content.ts'

const view=(name,phase,value)=>compactToolPresentation(name,phase,typeof value==='string'?value:JSON.stringify(value))
test('existing public platform pages and web searches display readable fields and do not invent task results',()=>{
 assert.deepEqual(view('platform_task_query','output',{offset:10,total:12,hasMore:false}),{
  fields:[{label:'查询起点',value:'10'},{label:'总数',value:'12'},{label:'还有更多',value:'否'}],
 })
 const data=view('platform_task_query','output',{total:1,tasks:[{title:'核对发布',status:'running',objective:'核对部署版本'}]})
 assert.deepEqual(data.items,[{title:'核对发布',state:'执行中',fields:[{label:'目标',value:'核对部署版本'}]}])
 assert.deepEqual(view('platform_config_query','output',{timeZone:'Asia/Shanghai',concurrency:4}).fields,[
  {label:'时区',value:'Asia/Shanghai'},{label:'并发数',value:'4'},
 ])
 assert.deepEqual(view('web_search','input',{queries:['查实际版本','核对发布日期']}),{terms:['查实际版本','核对发布日期']})
 assert.equal(view('web_search','output','existing external prose and links'),null)
})
test('native and platform schedule request formatting retains time zones and never claims unrecorded scheduling',()=>{
 assert.deepEqual(view('schedule_create','input',{title:'检查发布',weekly:{weekdays:[1,7],time:'09:00:00',time_zone:'Asia/Shanghai'}}),{
  fields:[{label:'标题',value:'检查发布'},{label:'每周',value:'周一、周日 09:00:00（Asia/Shanghai）'}],
 })
 assert.equal(view('schedule_update','input',{weekly:{weekdays:[0],time:'08:00:00',time_zone:'Asia/Shanghai'}}),null)
 assert.deepEqual(view('platform_schedule_submit','input',{at:'2026-11-24T09:00:00+08:00'}),{fields:[{label:'触发时间',value:'2026-11-24T09:00:00+08:00'}]})
 assert.equal(view('schedule_create','output','此工具尚未声明可展示的结果字段。'),null)
})
test('only documented text formats get job rows; request and past terminal status are not confused',()=>{
 assert.deepEqual(view('job_list','output','j-1 [shell] running — Verify setup').items[0],{
  title:'Verify setup',state:'执行中',fields:[{label:'作业编号',value:'j-1'},{label:'作业类型',value:'shell'}],
 })
 assert.deepEqual(view('job_list','output','(no background jobs)'),{notice:'没有后台作业'})
 assert.equal(view('job_list','output','arbitrary historical log'),null)
 assert.equal(view('job_kill','output','requested cancellation of job j-1').notice,'已请求取消')
 assert.equal(view('job_kill','output','job j-1 had already finished [status: completed, exit 0]').notice,'作业此前已结束')
 assert.equal(view('job_kill','output','job j-1 had already finished [status: running]'),null)
 const text='requested cancellation of job j-1'
 assert.equal(specializedToolPresentation({toolName:'job_kill',phase:'output',text,complete:false}).text,text)
 assert.equal(specializedToolPresentation({toolName:'job_kill',phase:'output',text,isError:true}).text,text)
})

test('communication reads and normalized native schedule projections show actual admitted information',()=>{
 assert.deepEqual(view('communication_guidance_read','input',{scope:'communication-guidance'}),{
  fields:[{label:'读取范围',value:'沟通指引'}],
 })
 assert.deepEqual(view('communication_guidance_read','output',{scope:'communication-guidance',read:true,documentVersion:1}),{
  notice:'这条记录没有可核验的指引正文。',
 })
 assert.equal(view('communication_guidance_read','output',{scope:'communication-guidance',read:false}),null)
 assert.deepEqual(view('schedule_list','output',{scheduleCount:1,schedules:[{title:'巡查任务',state:'scheduled',weekdays:[1,3],time:'08:00',timeZone:'Asia/Shanghai'}]}),{
  items:[{title:'巡查任务',state:'已安排',fields:[{label:'当地时间',value:'08:00'},{label:'时区',value:'Asia/Shanghai'},{label:'星期',value:'周一、周三'}]}],
  fields:[{label:'事项总数',value:'1'}],
 })
 assert.equal(view('schedule_list','output',{scheduleCount:1,schedules:[]}).notice,undefined)
})
