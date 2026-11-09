import {tokenizer} from 'acorn'
import {execFileSync} from 'node:child_process'
import {readdir,readFile} from 'node:fs/promises'
import {createHash} from 'node:crypto'
const candidates=[
 ['session','src/native-session-protocol.js'],
 ['projection','src/native-projections.js'],
 ['projection-fixture','test/fixtures/legacy-session-projection-interface.mjs','90245c0^'],
 ['fs-protocol','src/native-fs-protocol.js'],
 ['fs-observation','src/native-fs-observation-policy.js'],
]
const digest=value=>createHash('sha256').update(value).digest('hex')
function tokens(text){const result=[];for(const t of tokenizer(text,{ecmaVersion:'latest',sourceType:'module',locations:true})){if(t.type.label==='eof')break;result.push({key:JSON.stringify([t.type.label,t.value],(_key,value)=>typeof value==='bigint'?value+'n':value),line:t.loc.start.line})}return result}
const windows=rows=>rows.slice(39).map((_,i)=>digest(rows.slice(i,i+40).map(t=>t.key).join('\n')))
const sources=candidates.map(([tag,path,rev='457270a'])=>{const text=execFileSync('git',['show',rev+':'+path],{encoding:'utf8'});return{tag,path,rev,sha256:digest(text),windows:new Set(windows(tokens(text)))}})
const matches=[],failures=[];let parsed=0
async function walk(dir){for(const e of await readdir(dir,{withFileTypes:true})){const path=dir+'/'+e.name;if(e.isDirectory())await walk(path);else if(e.isFile()&&/\.(?:js|mjs|cjs)$/.test(path)){
 let rows;try{rows=tokens(await readFile(path,'utf8'));parsed++}catch(e){failures.push({path,error:e.message});continue}
 const hashes=windows(rows)
 for(const source of sources){const indices=hashes.flatMap((h,i)=>source.windows.has(h)?[i]:[]);if(indices.length)matches.push({tag:source.tag,path,windows:indices.length,firstLine:rows[indices[0]].line})}
}}}
for(const dir of ['src','bin','packages','test','scripts'])await walk(dir)
console.log(JSON.stringify({method:'Exact continuous 40-token matching, supplemental to source/caller review; not a general copyright test',baseline:'457270a',sources:sources.map(({windows,...source})=>source),parsed,failures,matches},null,2))
if(failures.length)process.exitCode=1
