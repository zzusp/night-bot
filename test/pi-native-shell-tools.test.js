import test from 'node:test'
import assert from 'node:assert/strict'
import * as bash from '../src/native-tool-bash.js'
import * as pwsh from '../src/native-tool-pwsh.js'
function fixture(impl,result={stdout:{text:'output',truncated:false},stderr:{text:'warning',truncated:false},exitCode:3,signal:null,timedOut:false,aborted:false,timeoutMs:1000}){const tools=new Map(),calls=[],ctx={tools:{register:t=>{tools.set(t.name,t);return()=>tools.delete(t.name)}},systemPrompt:{section(){},getSectionOrder:()=>1},workingDirectory:{ensure:async(...args)=>{calls.push(['cwd',...args]);return'/actor cwd'}},shellEnv:{collect:exec=>{calls.push(['env',exec]);return{NIGHT_BOT_SESSION_ID:exec.agent.id}}},shell:{sandboxMode:undefined,resolve:r=>({...r,timeoutMs:r.timeoutMs??1000,workdir:r.workdir??'/fallback'}),execute:async spec=>{calls.push(['execute',spec]);return{result:async()=>result}}},get:()=>undefined};impl.apply(ctx,{enableRunInBackground:false,promoteOnTimeout:false});return{tools,calls}}
test('shell tools pass exact execution facts, working directory and cancellation to the executor',async()=>{
 for(const [impl,name] of [[bash,'bash'],[pwsh,'pwsh']]){
  const h=fixture(impl),tool=h.tools.get(name),exec={agent:{id:'actor'},signal:new AbortController().signal,callId:'shell-contract-'+name},args={command:'literal fixture command',description:'isolated fixture'}
  assert.equal(tool.parameters.properties.command.type,'string')
  assert.ok(tool.parameters.required.includes('command'))
  const value=await tool.execute(args,exec),text=tool.output.render(args,value).map(block=>block.text??'').join('')
  assert.equal(value.kind,'foreground');assert.equal(value.exitCode,3)
  assert.equal(text,['output','[stderr]','warning','','Command exited with code 3'].join(String.fromCharCode(10)));assert.deepEqual(value.piOutput,{text,truncated:false})
  assert.equal(h.calls[0][1],exec.agent);assert.equal(h.calls[1][1],exec)
  const request=h.calls.find(call=>call[0]==='execute')[1]
  assert.equal(request.workdir,'/actor cwd');assert.equal(request.signal,exec.signal)
  assert.deepEqual(request.executionEnv,{NIGHT_BOT_SESSION_ID:'actor'})
  assert.equal('dshEnv' in request,false)
  const lines=Array.from({length:2002},(_,i)=>'line-'+String(i).padStart(4,'0'))
  const cases=[
   {stdout:'',stderr:'',exitCode:0,want:'(no output)',truncated:false},
   {stdout:'',stderr:'',exitCode:9,want:['(no output)','','Command exited with code 9'].join(String.fromCharCode(10)),truncated:false},
   {stdout:lines.join(String.fromCharCode(10)),stderr:'',exitCode:0,want:lines.slice(2).join(String.fromCharCode(10)),truncated:true},
   {stdout:'a'.repeat(60000),stderr:'',exitCode:0,want:'a'.repeat(51200),truncated:true},
   {stdout:String.fromCodePoint(0x5c3e).repeat(18000),stderr:'',exitCode:0,want:String.fromCodePoint(0x5c3e).repeat(17066),truncated:true},
   {stdout:'retained tail',stderr:'',exitCode:0,want:'retained tail',truncated:true,spillPath:'/fixture/owned-spill'},
  ]
  for(const row of cases){
   const result={stdout:{text:row.stdout,truncated:Boolean(row.spillPath),...row.spillPath?{spillPath:row.spillPath}:{}},stderr:{text:row.stderr,truncated:false},exitCode:row.exitCode,signal:null,timedOut:false,aborted:false,timeoutMs:1250}
   const f=fixture(impl,result),registered=f.tools.get(name),input={...args,timeoutMs:1250},output=await registered.execute(input,exec)
   assert.equal(output.exitCode,row.exitCode);assert.deepEqual(output.stdout,result.stdout);assert.deepEqual(output.stderr,result.stderr)
   assert.deepEqual(output.piOutput,{text:row.want,truncated:row.truncated});assert.equal(output.piOutput.text.includes(String.fromCodePoint(0xfffd)),false)
   assert.equal(f.calls.filter(call=>call[0]==='execute').length,1);assert.equal(f.calls.find(call=>call[0]==='execute')[1].timeoutMs,1250)
   if(row.spillPath)assert.match(registered.output.render(input,output)[0].text,/full output: \/fixture\/owned-spill/)
  }
 }
})
test('native shell tools reject disabled background and unadvertised escalation before execution',async()=>{for(const impl of [bash,pwsh]){const h=fixture(impl),tool=[...h.tools.values()][0],exec={agent:{id:'actor'},signal:new AbortController().signal},base={command:'fixture',description:'fixture'};await assert.rejects(tool.execute({...base,run_in_background:true},exec),/disabled/);await assert.rejects(tool.execute({...base,sandbox_permissions:'require_escalated',justification:'fixture must not execute'},exec));await assert.rejects(tool.execute({...base,command:' '},exec));assert.equal(h.calls.filter(c=>c[0]==='execute').length,0)}})
