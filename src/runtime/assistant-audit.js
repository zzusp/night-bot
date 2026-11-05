import {deepFreeze} from '../native-values.js'

// Application producer for Night's existing compact audit format. Its historical
// format/reader attribution remains in native-message-protocol.js and
// licenses/dsh-llm-MIT.txt. This is diagnostic storage, never model history.
const deltaFormats={
 'text-delta':{type:'text-chunks',field:'texts',value:'text',identity:['index']},
 'reasoning-delta':{type:'reasoning-chunks',field:'texts',value:'text',identity:['index']},
 'tool-call-delta':{type:'tool-call-chunks',field:'args',value:'argumentsDelta',identity:['index','id','name']},
}
/** Accept only already detached, immutable JSON chunks from the observation. */
export function createAssistantAudit(){
 const records=[]
 let tailTime,tailKey
 return Object.freeze({
  append(time,chunk){
   const format=deltaFormats[chunk.type]
   // Empty tool identities are valid diagnostics, but not a packed run.
   if(!format||(chunk.type==='tool-call-delta'&&(!chunk.id||chunk.name===''))){
    records.push({type:'chunk',time,chunk});tailKey=undefined;return
   }
   const identity=Object.fromEntries(format.identity.filter(key=>Object.hasOwn(chunk,key)).map(key=>[key,chunk[key]]))
   const key=JSON.stringify([format.type,identity]),gap=time-tailTime
   if(key===tailKey&&Number.isSafeInteger(gap)&&tailTime+gap===time){
    const tail=records.at(-1);tail.dt.push(gap);tail[format.field].push(chunk[format.value])
   }else records.push({type:format.type,time0:time,...identity,dt:[],[format.field]:[chunk[format.value]]})
   tailKey=key;tailTime=time
  },
  snapshot(){return deepFreeze(records.map(record=>record.type==='chunk'?{...record}:{...record,dt:[...record.dt],...record.args?{args:[...record.args]}:{texts:[...record.texts]}}))},
 })
}
