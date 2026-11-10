import {boundedRead} from './previous.js'
import {DatabaseSync} from 'node:sqlite'
import {lstat,chmod,readdir,readFile} from 'node:fs/promises'
import {join,resolve,relative,dirname,basename} from 'node:path'
import {parseFrontmatter} from '@earendil-works/pi-coding-agent'
import {privateDirectory,readRegular,failure} from '../runtime/files.js'
import {inside} from '../runtime/paths.js'
import {parseSkillFrontmatter} from '../native-skill-filesystem.js'
import {hash} from './format.js'
export const contentVersion=(content,provider)=>{let body=provider==='learned'?content.replace(/^NIGHT_LEARNED_SCOPE=[^\n]*\n?/gm,''):content;try{body=parseFrontmatter(body).body}catch{}return hash(body.replaceAll('\r\n','\n').trim())}
export const skillIdentity=({name,provider,path,installRoot})=>hash(JSON.stringify([provider,name,path&&installRoot&&inside(installRoot,path)?'install:'+relative(installRoot,path).split('\\').join('/'):path??null]))
export function botSkillRoots(paths,extra=[]){return [...new Set([paths.skills,paths.agentsHome&&join(paths.agentsHome,'skills'),paths.harnessHome&&join(paths.harnessHome,'skills'),...extra.map(path=>resolve(paths.installRoot,path))].filter(Boolean))]}
export function commonSkillPath(paths,path){const owned=[paths.skills,paths.agentsHome&&join(paths.agentsHome,'skills'),paths.harnessHome&&join(paths.harnessHome,'skills')].filter(Boolean);return owned.some(root=>inside(root,path))||![paths.state,paths.memory,paths.secrets,paths.workspaces,paths.cache,paths.logs,paths.runtime,paths.temp,paths.attachments].filter(Boolean).some(root=>inside(root,path))}
export async function pathSafe(path,root,installRoot=root){if(!inside(root,path)||!inside(installRoot,root))throw failure('SKILL_INVENTORY_PATH_UNSAFE');let at=resolve(path);for(;;){const info=await lstat(at).catch(error=>{if(error.code==='ENOENT')return;throw error});if(info?.isSymbolicLink()||info?.isFile()&&info.nlink!==1)throw failure('SKILL_INVENTORY_PATH_UNSAFE');if(at===installRoot||dirname(at)===at)break;at=dirname(at)}}
export async function openSkillUsage(directory){
 await privateDirectory(directory);const file=join(directory,'skill-usage.sqlite')
 for(const suffix of ['','-wal','-shm','-journal']){const info=await lstat(file+suffix).catch(error=>{if(error.code==='ENOENT')return;throw error});if(info&&(!info.isFile()||info.isSymbolicLink()||info.nlink!==1))throw failure('SKILL_USAGE_PATH_UNSAFE')}
 const db=new DatabaseSync(file);if(process.platform!=='win32')await chmod(file,0o600)
 db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS calls(id TEXT PRIMARY KEY,resource TEXT NOT NULL,name TEXT NOT NULL,provider TEXT NOT NULL,version TEXT NOT NULL,mode TEXT NOT NULL,at TEXT NOT NULL); CREATE INDEX IF NOT EXISTS calls_resource ON calls(resource,at); CREATE TABLE IF NOT EXISTS metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL)')
 db.prepare('INSERT OR IGNORE INTO metadata VALUES (?,?)').run('trackingSince',new Date().toISOString())
 return {record({eventId,resource,name,provider,version,mode}){if(!/^[a-f0-9]{64}$/.test(eventId)||!/^[a-f0-9]{64}$/.test(resource)||!/^[a-f0-9]{64}$/.test(version)||!['model','user','file-read'].includes(mode)||typeof name!=='string'||typeof provider!=='string')throw failure('SKILL_USAGE_INVALID');db.prepare('INSERT OR IGNORE INTO calls VALUES (?,?,?,?,?,?,?)').run(eventId,resource,name,provider,version,mode,new Date().toISOString())},
  inspect(){const items=db.prepare("SELECT resource,name,provider,count(*) AS count,sum(mode='model') AS modelCount,sum(mode='user') AS userCount,sum(mode='file-read') AS fileReadCount,max(CASE WHEN mode<>'file-read' THEN at END) AS lastInvocationAt,max(at) AS lastUsedAt FROM calls GROUP BY resource,name,provider").all().map(row=>({...row,lastVersion:db.prepare("SELECT version FROM calls WHERE resource=? AND mode<>'file-read' ORDER BY at DESC,rowid DESC LIMIT 1").get(row.resource)?.version??null}));return {trackingSince:db.prepare('SELECT value FROM metadata WHERE key=?').get('trackingSince').value,items}},close(){db.close()}}
}
// File inventory is not a model use. Metadata/body hashing never increments calls.
export async function installedSkills(paths,extra=[],{onContent}={}){
 const roots=botSkillRoots(paths,extra),items=[],issues=[],selected=new Set(),files=new Map();let visited=0
 for(const root of roots){
  if(paths.installRoot&&!inside(paths.installRoot,root)){issues.push('配置目录不属于当前安装');continue}
  const walk=async(path,depth)=>{
   if(!commonSkillPath(paths,path)){issues.push('已跳过非公共技能的私有数据目录');return}
   if(++visited>10000||depth>24){issues.push('目录盘点超过安全上限');return}
   try{await pathSafe(path,root,paths.installRoot??root);const entries=await readdir(path,{withFileTypes:true}).catch(error=>{if(error.code==='ENOENT')return [];throw error})
    for(const entry of entries.sort((a,b)=>a.name.localeCompare(b.name))){const file=join(path,entry.name)
     if(entry.isSymbolicLink()){issues.push('已跳过符号链接资源');continue}
     if(entry.isDirectory()){await walk(file,depth+1);continue}
     if(!entry.isFile()||!(entry.name==='SKILL.md'||depth===0&&entry.name.endsWith('.md')))continue
     if(++visited>10000){issues.push('目录盘点超过安全上限');break}
     try{await pathSafe(file,root,paths.installRoot??root);const loaded=await boundedRead(file,undefined,{root:paths.installRoot??root});if(!loaded)continue;const raw=loaded.text,info=await lstat(file);let parsed;try{parsed=parseSkillFrontmatter(raw)}catch{}
     const priorFile=files.get(file);if(priorFile?.discovered||priorFile&&!((depth===0&&entry.name.endsWith('.md'))||(depth===1&&entry.name==='SKILL.md')))continue
     const registeredRoot=paths.mode!=='legacy'||extra.map(value=>resolve(paths.installRoot,value)).includes(root)||root===join(paths.agentsHome,'skills')
     const name=parsed?.name??(entry.name==='SKILL.md'?basename(path):entry.name),discoverable=registeredRoot&&(depth===0&&entry.name.endsWith('.md')||depth===1&&entry.name==='SKILL.md'),duplicate=parsed&&selected.has(parsed.name)
     const available=!!parsed&&discoverable&&!duplicate&&(parsed.invocation.modelInvocable||parsed.invocation.userInvocable)
     if(parsed&&discoverable&&!duplicate)selected.add(parsed.name)
     const item={id:skillIdentity({name,provider:'filesystem',path:file,installRoot:paths.installRoot}),kind:'skill',scope:'bot',origin:'installed',name,location:relative(paths.installRoot??root,file).split('\\').join('/'),status:available?'applied':!parsed?'invalid':duplicate?'shadowed':!discoverable?'undiscovered':'disabled',revision:hash(raw),contentVersion:parsed?contentVersion(parsed.content):null,updatedAt:info.mtime.toISOString(),modelInvocable:parsed?.invocation.modelInvocable??false,userInvocable:parsed?.invocation.userInvocable??false};if(priorFile)Object.assign(priorFile.item,item);else items.push(item);files.set(file,{item:priorFile?.item??item,discovered:discoverable});await onContent?.(item,{...loaded,path:file})
     }catch{issues.push('部分技能文件不可安全读取')}
    }
   }catch{issues.push('部分技能目录或文件不可安全读取')}
  }
  await walk(root,0)
 }
 return {items,issues:[...new Set(issues)],complete:issues.length===0}
}
