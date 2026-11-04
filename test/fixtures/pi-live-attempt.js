import {AssistantStreamAccumulator,BlockAssembler} from '@deepseek-ai/dsh-llm'
/** Test audit observer with the same public accumulators as the application. */
export function createLiveAttempt(){const assembler=new BlockAssembler(),acc=new AssistantStreamAccumulator();return{starts:0,count:0,start(){this.starts++},push(chunk){this.count++;acc.push({time:1,chunk});assembler.push(chunk)},blocks:()=>assembler.blocks(),get finish(){return assembler.finish},get usage(){return assembler.usage},get replayState(){return assembler.replayState},get stream(){return acc.snapshot()}}}
