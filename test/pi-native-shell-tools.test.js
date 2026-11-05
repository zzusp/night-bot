import test from 'node:test'
import assert from 'node:assert/strict'
import * as bash from '../src/native-tool-bash.js'
import * as pwsh from '../src/native-tool-pwsh.js'
function fixture(impl){const tools=new Map(),calls=[],ctx={tools:{register:t=>{tools.set(t.name,t);return()=>tools.delete(t.name)}},systemPrompt:{section(){},getSectionOrder:()=>1},workingDirectory:{ensure:async(...args)=>{calls.push(['cwd',...args]);return'/actor cwd'}},shellEnv:{collect:exec=>{calls.push(['env',exec]);return{NIGHT_BOT_SESSION_ID:exec.agent.id}}},shell:{sandboxMode:undefined,resolve:r=>({...r,timeoutMs:r.timeoutMs??1000,workdir:r.workdir??'/fallback'}),execute:async spec=>{calls.push(['execute',spec]);return{result:async()=>({stdout:{text:'output',truncated:false},stderr:{text:'warning',truncated:false},exitCode:3,signal:null,timedOut:false,aborted:false,timeoutMs:1000})}}},get:()=>undefined};impl.apply(ctx,{enableRunInBackground:false,promoteOnTimeout:false});return{tools,calls}}
test('shell tools pass exact execution facts, working directory and cancellation to the executor',async()=>{
 for(const [impl,name] of [[bash,'bash'],[pwsh,'pwsh']]){
  const h=fixture(impl),tool=h.tools.get(name),exec={agent:{id:'actor'},signal:new AbortController().signal},args={command:'literal fixture command',description:'isolated fixture'}
  assert.equal(tool.parameters.properties.command.type,'string')
  assert.ok(tool.parameters.required.includes('command'))
  const value=await tool.execute(args,exec),text=tool.output.render(args,value).map(block=>block.text??'').join('')
  assert.equal(value.kind,'foreground');assert.equal(value.exitCode,3)
  assert.match(text,/output/);assert.match(text,/warning/);assert.match(text,/\[exit code: 3\]/)
  assert.equal(h.calls[0][1],exec.agent);assert.equal(h.calls[1][1],exec)
  const request=h.calls.find(call=>call[0]==='execute')[1]
  assert.equal(request.workdir,'/actor cwd');assert.equal(request.signal,exec.signal)
  assert.deepEqual(request.executionEnv,{NIGHT_BOT_SESSION_ID:'actor'})
  assert.equal('dshEnv' in request,false)
 }
})
test('native shell tools reject disabled background and unadvertised escalation before execution',async()=>{for(const impl of [bash,pwsh]){const h=fixture(impl),tool=[...h.tools.values()][0],exec={agent:{id:'actor'},signal:new AbortController().signal},base={command:'fixture',description:'fixture'};await assert.rejects(tool.execute({...base,run_in_background:true},exec),/disabled/);await assert.rejects(tool.execute({...base,sandbox_permissions:'require_escalated',justification:'fixture must not execute'},exec));await assert.rejects(tool.execute({...base,command:' '},exec));assert.equal(h.calls.filter(c=>c[0]==='execute').length,0)}})
