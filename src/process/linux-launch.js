// Application-owned one-shot Linux launch transport. No target environment is
// loaded until Node has started with the parent's bootstrap-safe environment.
import {constants, mkdtempSync, chmodSync, openSync, closeSync, fstatSync, lstatSync, readSync, writeFileSync, unlinkSync, rmdirSync, realpathSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join, dirname, basename, isAbsolute, resolve} from 'node:path'

const ownedDirectories = new WeakMap()
const LIMIT = 8 * 1024 * 1024
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const exact = (value, required, optional = []) => record(value) && required.every(key => Object.hasOwn(value,key)) && Object.keys(value).every(key => [...required,...optional].includes(key))
function privateEntry(stat, directory = false) {
  if (!(directory ? stat.isDirectory() : stat.isFile()) || stat.isSymbolicLink() || (stat.mode & 0o777) !== (directory ? 0o700 : 0o600) || (process.getuid && stat.uid !== process.getuid()) || (!directory && (stat.nlink !== 1 || stat.size > LIMIT))) throw new Error('unsafe private Linux launch entry')
}
function checkDirectory(directory) {
  const stat = lstatSync(directory)
  privateEntry(stat, true)
  if(realpathSync(directory) !== resolve(directory)) throw new Error('symlink in private Linux launch directory')
  return stat
}
const sameEntry = (left,right) => left.dev === right.dev && left.ino === right.ino
function inDirectory(path, operation) {
  const directory = dirname(path), before = checkDirectory(directory)
  const fd = openSync(directory, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW)
  try {
    const opened = fstatSync(fd)
    privateEntry(opened,true)
    if(!sameEntry(before,opened)) throw new Error('Linux launch directory changed while opening')
    const anchored = `/proc/self/fd/${fd}/${basename(path)}`
    const result = operation(anchored,opened)
    if(!sameEntry(opened,checkDirectory(directory))) throw new Error('Linux launch directory changed during operation')
    return result
  } finally {closeSync(fd)}
}
export function linuxLaunchFilesFromLocator(requestPath) {
  if (typeof requestPath !== 'string' || !isAbsolute(requestPath) || basename(requestPath) !== 'launch-request.json') throw new Error('invalid Linux launch-request locator')
  const directory = dirname(requestPath)
  return {directory,requestPath,startupErrorPath:join(directory,'startup-error.json')}
}
function readPrivate(path, consume = false) {
  return inDirectory(path, anchored => {
  const fd = openSync(anchored, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
  try {
    const before = fstatSync(fd)
    privateEntry(before)
    // Allocate only the observed size plus one EOF probe, never follow growth.
    const bytes = Buffer.allocUnsafe(before.size + 1)
    let offset = 0
    while(offset < before.size) {
      const count = readSync(fd,bytes,offset,before.size-offset,offset)
      if(count === 0) throw new Error('Linux launch entry changed while reading')
      offset += count
    }
    if(readSync(fd,bytes,offset,1,offset) !== 0) throw new Error('Linux launch entry grew while reading')
    const finished = fstatSync(fd)
    privateEntry(finished)
    if(!sameEntry(before,finished) || before.size !== finished.size || before.mtimeMs !== finished.mtimeMs || before.ctimeMs !== finished.ctimeMs) throw new Error('Linux launch entry changed while reading')
    const after = lstatSync(anchored)
    privateEntry(after)
    if (!sameEntry(before,after) || before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) throw new Error('Linux launch entry changed while reading')
    const text = new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes.subarray(0,offset))
    if (consume) unlinkSync(anchored)
    return JSON.parse(text)
  } finally { closeSync(fd) }
  })
}
function writePrivate(path, value) {
  const text = JSON.stringify(value)
  if (Buffer.byteLength(text) > LIMIT) throw new Error('Linux launch entry exceeds limit')
  return inDirectory(path, anchored => {
  const fd = openSync(anchored, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600)
  try { writeFileSync(fd,text) } finally { closeSync(fd) }
  })
}
function requestValue(value) {
  if (!exact(value,['cwd','env'],['control']) || typeof value.cwd !== 'string' || value.cwd.includes('\0') || !record(value.env) || Object.entries(value.env).some(([key,item]) => typeof item !== 'string' || key.includes('\0') || key.includes('=') || item.includes('\0')) || (value.control !== undefined && value.control !== 'pipe')) throw new Error('invalid Linux launch request')
  return {cwd:value.cwd,env:value.env,...value.control === 'pipe' ? {control:'pipe'} : {}}
}
export function createLinuxLaunchFiles(request) {
  const value = requestValue(request)
  const directory = mkdtempSync(join(tmpdir(),'night-bot-launch-'))
  const files = linuxLaunchFilesFromLocator(join(directory,'launch-request.json'))
  try { chmodSync(directory,0o700); ownedDirectories.set(files,checkDirectory(directory)); writePrivate(files.requestPath,value); return files }
  catch (error) { cleanupLinuxLaunchFiles(files); throw error }
}
export function consumeLinuxLaunchRequest(path) { return requestValue(readPrivate(path,true)) }
export function writeLinuxStartupError(files,error) { writePrivate(files.startupErrorPath,error) }
export function readLinuxStartupError(path) {
  let value
  try { value = readPrivate(path) } catch(error) { if(error.code === 'ENOENT') return; throw error }
  if (!exact(value,['type','error']) || value.type !== 'error' || !exact(value.error,['name','message'],['code','syscall','path']) || Object.values(value.error).some(item => typeof item !== 'string')) throw new Error('invalid Linux startup error')
  return value
}
export function cleanupLinuxLaunchFiles(files) {
  // Never traverse a replaced launch directory. Failure leaves metadata for
  // diagnosis rather than deleting something whose ownership cannot be proved.
  try {
    const expected = ownedDirectories.get(files)
    if(!expected || !sameEntry(expected,checkDirectory(files.directory))) return
    for (const path of [files.requestPath,files.startupErrorPath]) {
      if (dirname(path) !== files.directory || !['launch-request.json','startup-error.json'].includes(basename(path))) return
      try { inDirectory(path,(anchored,opened)=>{
        if(!sameEntry(expected,opened)) throw new Error('Linux launch cleanup ownership changed')
        unlinkSync(anchored)
      }) } catch(error) { if(error.code !== 'ENOENT') return }
    }
    if(sameEntry(expected,checkDirectory(files.directory))) rmdirSync(files.directory)
  } catch {}
}
