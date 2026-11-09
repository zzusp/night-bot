import assert from 'node:assert/strict'
import {basename} from 'node:path'
import {ManagedProcessRuntime} from '../../src/process/index.js'
assert.equal(process.platform,'linux')
const descriptor=Object.getOwnPropertyDescriptor(ManagedProcessRuntime.prototype,'selectContainmentMode')
assert.equal(typeof descriptor?.value,'function')
const original=descriptor.value
let sequence=0
function record(event){process.stdout.write('SG11_PROVIDER_OBSERVATION '+JSON.stringify({pid:process.pid,file:basename(process.argv[1]??''),sequence:++sequence,...event})+'\n')}
// 只包裹实际spawn会调用的原选择器；不预跑probe，不注入provider，不改变this或参数。
Object.defineProperty(ManagedProcessRuntime.prototype,'selectContainmentMode',{...descriptor,value:function(...args){
 let selected
 try{selected=Reflect.apply(original,this,args)}catch(error){record({kind:args[0],outcome:'threw',code:error?.code??null});throw error}
 record({kind:args[0],outcome:'returned',selected})
 return selected
}})
