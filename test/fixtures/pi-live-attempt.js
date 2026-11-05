import {createAttemptObservation} from '../../src/runtime/attempt-observation.js'
/** Test instrumentation around the actual production observation. */
export function createLiveAttempt(){
 const observation=createAttemptObservation()
 return {count:0,push(chunk){this.count++;observation.push(chunk)},blocks:()=>observation.blocks(),
  get finish(){return observation.finish},get usage(){return observation.usage},
  get replayState(){return observation.replayState},get stream(){return observation.stream}}
}
