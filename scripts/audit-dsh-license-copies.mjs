import {tokenizer} from 'acorn'
import {execFileSync} from 'node:child_process'
import {readdir,readFile} from 'node:fs/promises'
import {createHash} from 'node:crypto'
const candidates=[['time-zone','src/native-time-zone.js','9a3d60b'],['consumed-work','src/native-consumed-work.js','9a3d60b'],['search','src/native-tool-fs-search.js','729d231^'],['session-equality','src/native-values.js','9a3d60b'],['session-title','src/native-capability-errors.js','9a3d60b']]
const digest=value=>createHash('sha256').update(value).digest('hex')
function tokens(text){const result=[];for(const t of tokenizer(text,{ecmaVersion:'latest',sourceType:'module',locations:true})){if(t.type.label==='eof')break;result.push({key:JSON.stringify([t.type.label,t.value],(_key,value)=>typeof value==='bigint'?value+'n':value),line:t.loc.start.line})}return result}
const windows=(rows,size=40)=>rows.slice(size-1).map((_,i)=>digest(rows.slice(i,i+size).map(t=>t.key).join('\n')))
const sources=candidates.map(([tag,path,rev])=>{
 const original=execFileSync('git',['show',rev+':'+path],{encoding:'utf8'})
 const text=tag==='session-equality'?original.match(/function deepEqualJson[\s\S]*?\n}/)[0]:tag==='session-title'?original.match(/var SessionTitleInvalidError[\s\S]*?\n};/)[0]:original
 const rows=tokens(text),size=Math.min(40,rows.length)
 return{tag,path,rev,sha256:digest(original),reviewedFragmentSha256:digest(text),windowTokens:size,windows:new Set(windows(rows,size))}
})
const matches=[],failures=[];let parsed=0
async function walk(dir){for(const e of await readdir(dir,{withFileTypes:true})){const path=dir+'/'+e.name;if(e.isDirectory())await walk(path);else if(e.isFile()&&/\.(?:js|mjs|cjs)$/.test(path)){
 let rows;try{rows=tokens(await readFile(path,'utf8'));parsed++}catch(e){failures.push({path,error:e.message});continue}
 for(const source of sources){const hashes=windows(rows,source.windowTokens);const indices=hashes.flatMap((h,i)=>source.windows.has(h)?[i]:[]);if(indices.length)matches.push({tag:source.tag,path,windows:indices.length,firstLine:rows[indices[0]].line})}
}}}
for(const dir of ['src','bin','packages','test','scripts','docs'])await walk(dir)
console.log(JSON.stringify({method:'Exact continuous 40-token matching, supplemental to source/caller review; not a general copyright test',baseline:'Per-source revisions below',sources:sources.map(({windows,...source})=>source),parsed,failures,matches},null,2))
if(failures.length)process.exitCode=1
