import {open,readFile,lstat,unlink,rename,mkdir,realpath,opendir} from 'node:fs/promises'
import {dirname,basename,join,resolve} from 'node:path'
import {createHash,randomUUID} from 'node:crypto'
import {setTimeout as delay} from 'node:timers/promises'
const absent=e=>e?.code==='ENOENT'
export async function canonicalizeWatchPath(filename){let at=resolve(filename);const tail=[];for(;;){try{const base=await realpath(at);if(tail.length){const dir=await opendir(base);await dir.close()}return join(base,...tail.reverse())}catch(e){if(!absent(e))throw e;const parent=dirname(at);if(parent===at)throw e;tail.push(basename(at));at=parent}}}
const identity=(a,b)=>a.dev===b.dev&&a.ino===b.ino
async function dead(record){if(!/^[1-9][0-9]*\n$/.test(record))return false;const pid=Number(record.trim());if(!Number.isSafeInteger(pid)||pid>2147483647||pid===process.pid)return false;try{process.kill(pid,0);return false}catch(e){return e.code==='ESRCH'}}
async function steal(lock){let record;try{record=await readFile(lock,'utf8')}catch(e){if(absent(e))return;throw e}if(!await dead(record))return;const claim=lock+'.takeover-'+createHash('sha256').update(record).digest('hex').slice(0,16);let fd;try{fd=await open(claim,'wx',0o600)}catch(e){if(e.code==='EEXIST'||e.code==='EPERM')return;throw e}const own=await fd.stat();try{await fd.writeFile(`${process.pid}\n`);if(await readFile(lock,'utf8')===record&&await dead(record))await unlink(lock)}catch(e){if(!absent(e))throw e}finally{try{if(identity(own,await lstat(claim)))await unlink(claim)}catch(e){if(!absent(e))throw e}finally{await fd.close()}}}
/** Legacy PID-newline lock and takeover filenames are retained so mixed-version
 * token refreshers serialize. An open inode binds our writes/releases to ownership. */
export async function withCredentialLock(filename,operation,{waitMs=30000,closed=()=>false}={}){
 const lock=filename+'.lock',start=Date.now();let backoff=20,fd,unconfirmed=false
 await mkdir(dirname(filename),{recursive:true,mode:0o700})
 for(;;){if(closed())throw new Error('Credential store closed before writer admission');try{fd=await open(lock,'wx',0o600);break}catch(e){if(e.code!=='EEXIST'&&e.code!=='EPERM')throw e;if(e.code==='EPERM'){try{await lstat(lock)}catch(check){if(!absent(check))throw check;if(unconfirmed)throw e;unconfirmed=true}}await steal(lock);if(Date.now()-start>=waitMs)throw new Error('Credential writer lock timed out');await delay(Math.min(backoff,Math.max(0,waitMs-(Date.now()-start))));backoff=Math.min(backoff*2,200)}}
 const own=await fd.stat();const assertOwned=async()=>{if(!identity(own,await lstat(lock))||await readFile(lock,'utf8')!==`${process.pid}\n`)throw new Error('Credential writer lock ownership changed')}
 try{await fd.writeFile(`${process.pid}\n`);if(closed())throw new Error('Credential store closed before writer admission');return await operation(assertOwned)}finally{try{if(identity(own,await lstat(lock)))await unlink(lock)}catch(e){if(!absent(e))throw e}finally{await fd.close()}}
}
export async function writeCredentialFile(filename,text,assertOwned){
 const temp=filename+'.tmp-'+randomUUID();let fd,renamed=false
 try{fd=await open(temp,'wx',0o600);await fd.writeFile(text);await fd.sync();await fd.close();fd=undefined;await assertOwned();let retry=0;for(;;){try{await rename(temp,filename);renamed=true;break}catch(e){if(process.platform!=='win32'||!['EACCES','EBUSY','EPERM'].includes(e.code)||retry++>=8)throw e;await delay(Math.min(20*2**retry,200));await assertOwned()}}if(process.platform!=='win32'){const parent=await open(dirname(filename),'r');try{await parent.sync()}finally{await parent.close()}}}finally{if(fd)await fd.close();if(!renamed)try{await unlink(temp)}catch(e){if(!absent(e))throw e}}
}
