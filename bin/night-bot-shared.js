#!/usr/bin/env node
import {createHash} from 'node:crypto'
import {readFile,stat,writeFile} from 'node:fs/promises'
import {parseArgs} from 'node:util'
import {resolve} from 'node:path'
import {loadConfig} from '../src/config.js'
import {runtimePaths} from '../src/runtime/paths.js'
import {MAX_SHARED_FILE_BYTES} from '../src/shared-resources/store.js'
import {readSharedOperatorToken,SHARED_OPERATOR_ROUTE} from '../src/shared-resources/operator.js'

try{
 const {positionals:[configPath,requestPath],values}=parseArgs({args:process.argv.slice(2),allowPositionals:true,options:{
  file:{type:'string'},output:{type:'string'},help:{type:'boolean'},
 }})
 if(values.help){console.log('Usage: node bin/night-bot-shared.js CONFIG REQUEST.json [--file INPUT_FILE | --output NEW_FILE]');process.exit(0)}
 if(!configPath||!requestPath||values.file&&values.output)throw Error('SHARED_USAGE')
 const configFile=resolve(configPath),config=await loadConfig(configFile)
 const host=config.resident?.host??'127.0.0.1',port=config.resident?.port??18998
 if(!['127.0.0.1','localhost','::1'].includes(host)||!Number.isInteger(port)||port<1||port>65535)throw Error('SHARED_LOCAL_ENDPOINT_REQUIRED')
 if((await stat(requestPath)).size>65536)throw Error('SHARED_REQUEST_TOO_LARGE')
 const input=JSON.parse(await readFile(requestPath,'utf8'))
 if(!input||typeof input!=='object'||Array.isArray(input)||Object.hasOwn(input,'contentBase64'))throw Error('SHARED_INVALID')
 if(values.output&&input.action!=='read')throw Error('SHARED_USAGE')
 if(values.file){
  if(!['publish','update'].includes(input.action)||input.kind!=='file')throw Error('SHARED_USAGE')
  if((await stat(values.file)).size>MAX_SHARED_FILE_BYTES)throw Error('SHARED_TOO_LARGE')
  const bytes=await readFile(values.file)
  if(bytes.length>MAX_SHARED_FILE_BYTES)throw Error('SHARED_TOO_LARGE')
  input.contentBase64=bytes.toString('base64')
 }
 const token=await readSharedOperatorToken(runtimePaths(config,configFile))
 const body=JSON.stringify(input)
 if(body.includes(token))throw Error('SHARED_INVALID')
 const response=await fetch(`http://${host==='::1'?'[::1]':host==='localhost'?'127.0.0.1':host}:${port}${SHARED_OPERATOR_ROUTE}`,
  {method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body,redirect:'error',signal:AbortSignal.timeout(30000)})
 if(response.ok&&response.headers.get('content-type')==='application/octet-stream'){
  if(!values.output){await response.body?.cancel();throw Error('SHARED_OUTPUT_REQUIRED')}
  const size=Number(response.headers.get('content-length')),sha256=response.headers.get('x-night-resource-sha256')
  if(!Number.isInteger(size)||size<0||size>MAX_SHARED_FILE_BYTES||!sha256)throw Error('SHARED_INTEGRITY')
  const bytes=Buffer.from(await response.arrayBuffer())
  if(bytes.length!==size||createHash('sha256').update(bytes).digest('hex')!==sha256)throw Error('SHARED_INTEGRITY')
  await writeFile(values.output,bytes,{flag:'wx',mode:0o600})
  console.log(JSON.stringify({status:'saved',id:response.headers.get('x-night-resource-id'),version:Number(response.headers.get('x-night-resource-version')),size,sha256}))
 }else{
  const value=await response.json()
  if(!response.ok||value.error)throw Error(value.error??'SHARED_REQUEST_FAILED')
  console.log(JSON.stringify(value,null,2))
 }
}catch(error){
 const message=typeof error?.message==='string'&&/^SHARED_[A-Z_]+$/u.test(error.message)?error.message:'SHARED_REQUEST_FAILED'
 console.error(message)
 process.exitCode=1
}
