import {readFile,readdir} from 'node:fs/promises'
import {builtinModules} from 'node:module'
const manifest=JSON.parse(await readFile('package.json','utf8')),builtins=new Set(builtinModules.map(name=>name.replace(/^node:/,'')))
const isDsh=value=>/^(?:npm:)?@deepseek-ai\/dsh(?:[-/@]|$)/.test(value)
let files=0,imports=0
async function* runtimeFiles(directory){for(const entry of await readdir(directory,{withFileTypes:true})){const path=directory+'/'+entry.name;if(entry.isDirectory())yield* runtimeFiles(path);else if(entry.isFile()&&/\.(?:js|mjs|cjs)$/.test(entry.name))yield path}}
for(const directory of ['src','bin','packages/dingtalk-core'])for await(const path of runtimeFiles(directory)){
  files++
  const source=await readFile(path,'utf8')
  // A bounded literal-import guard; dynamic plugin rows are audited separately.
  // Skip quoted code templates/interpolations which are not bare package names.
  for(const [,specifier]of source.matchAll(/(?:\bfrom\s*|\bimport\s*(?:\(\s*)?|\bcreateLazyRequire\s*\(\s*|\bimport\.meta\.resolve\s*\(\s*|\brequire\s*\(\s*)['"]([^'"\r\n]+)['"]/g)){
    if(specifier.startsWith('.')||specifier.startsWith('node:')||builtins.has(specifier))continue
    if(!/^(?:@[\w-]+\/[\w.-]+|[\w.-]+)(?:\/[\w./-]+)?$/.test(specifier))continue
    const packageName=specifier.startsWith('@')?specifier.split('/').slice(0,2).join('/'):specifier.split('/')[0]
    if(isDsh(packageName))throw new Error(`${path}: retired DSH runtime import ${specifier}`)
    imports++
    if(!manifest.dependencies?.[packageName])throw new Error(`${path}: runtime import ${packageName} is not a direct production dependency`)
  }
}
console.log(JSON.stringify({productionImportFiles:files,literalBareImports:imports,status:'declared-production-imports'}))
