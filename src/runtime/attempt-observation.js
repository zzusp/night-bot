import {AssistantStreamAccumulator,BlockAssembler} from '../native-message-protocol.js'
/** One-way application audit of a Pi provider invocation. Existing Night Bot
 * audit encoding/decoding remains attributed in native-message-protocol; this
 * observer owns no execution, publication frames, attempt ids or commit receipt. */
export function createAttemptObservation(){
 const audit=new AssistantStreamAccumulator(),content=new BlockAssembler()
 return Object.freeze({
  push(chunk){const admitted=audit.push({time:Date.now(),chunk});content.push(admitted.chunk)},
  blocks:()=>content.blocks(),
  get stream(){return audit.snapshot()},
  get usage(){return content.usage},
  get finish(){return content.finish},
  get replayState(){return content.replayState},
 })
}
