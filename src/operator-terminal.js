import {createInterface} from 'node:readline'
import {Writable} from 'node:stream'
import {OperatorAuthError} from './operator-auth.js'
/** Buffered line input also handles piped answers arriving before the first
 * prompt. Readline owns/restores raw mode; its output is muted for secrets. */
export function createOperatorInteraction({input=process.stdin,output=process.stderr,onInterrupt=()=>{}}={}){
 let hidden=true,ended=false,waiting,closed=false;const lines=[]
 const terminal=Boolean(input.isTTY&&output.isTTY)
 const sink=new Writable({write(chunk,encoding,done){if(!hidden)output.write(chunk,encoding);done()}})
 const rl=createInterface({input,output:sink,terminal,historySize:0})
 const wake=()=>{waiting?.();waiting=undefined}
 rl.on('line',line=>{if(lines.length>=64||Buffer.byteLength(line)>65536){ended=true;lines.length=0;rl.close()}else lines.push(line);wake()})
 rl.on('close',()=>{ended=true;wake()})
 rl.on('SIGINT',()=>{onInterrupt();wake()})
 async function readLine(prompt){
  prompt.signal?.throwIfAborted();hidden=prompt.kind==='secret'
  output.write(prompt.message+': ')
  const abort=()=>wake();prompt.signal?.addEventListener('abort',abort,{once:true})
  try{
   while(!lines.length){prompt.signal?.throwIfAborted();if(ended)throw new OperatorAuthError('NIGHT_BOT_AUTH_INPUT_CLOSED');await new Promise(resolve=>{waiting=resolve; if(lines.length||ended||prompt.signal?.aborted)wake()})}
   prompt.signal?.throwIfAborted();return lines.shift()
  }finally{prompt.signal?.removeEventListener('abort',abort);if(hidden)output.write('\n');hidden=true}
 }
 return{
  notify(notice){for(const value of [notice.message,notice.url,notice.code])if(typeof value==='string')output.write(value+'\n')},
  async prompt(prompt){
   if(prompt.kind!=='select')return readLine(prompt)
   for(const [i,option]of prompt.options.entries())output.write(`${i+1}. ${option.label}\n`)
   const answer=await readLine({...prompt,kind:'text'}),index=/^[1-9][0-9]*$/.test(answer)?Number(answer)-1:-1
   if(index<0||index>=prompt.options.length)throw new OperatorAuthError('NIGHT_BOT_AUTH_SELECTION_INVALID')
   return prompt.options[index].value
  },
  close(){if(closed)return;closed=true;lines.length=0;rl.close();sink.end()},
 }
}
