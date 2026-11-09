// Application Linux bootstrap: consume the private request once, then replace
// this process. The libc binding is supplied by the platform runner.
import {consumeLinuxLaunchRequest, linuxLaunchFilesFromLocator, writeLinuxStartupError} from './linux-launch.js'

function failureRecord(error, program, spawn = false) {
  const source = error instanceof Error ? error : new Error(String(error))
  const detail = Object.fromEntries(['code','syscall','path'].filter(key => typeof source[key] === 'string').map(key => [key,source[key]]))
  if (spawn && detail.code) return {name:'Error',message:`spawn ${program} ${detail.code}`,code:detail.code,syscall:`spawn ${program}`,path:program}
  return {name:source.name,message:source.message,...detail}
}
export function replaceLinuxTarget(argv, request, execve) {
  const [program,...args] = argv
  const execute = file => {
    try { return execve(file,[program,...args],request.env,request.control) }
    catch (error) {
      if (error.code !== 'ENOEXEC') throw error
      return execve('/bin/sh',['/bin/sh',file,...args],request.env,request.control)
    }
  }
  if (program.includes('/')) return execute(program)
  let denied
  for (const directory of (request.env.PATH ?? '/usr/bin:/bin').split(':')) {
    const base = directory.startsWith('/') ? directory : `${request.cwd}/${directory}`
    try { return execute(`${base.endsWith('/') ? base : `${base}/`}${program}`) }
    catch (error) {
      if (error.code === 'EACCES') denied ??= error
      else if (!['ENOENT','ENOTDIR'].includes(error.code)) throw error
    }
  }
  throw denied ?? Object.assign(new Error(`spawn ${program} ENOENT`),{code:'ENOENT',syscall:`spawn ${program}`,path:program})
}
export function runLinuxBootstrap(locator, argv, host, execve) {
  const files = linuxLaunchFilesFromLocator(locator)
  let starting = false
  try {
    const request = consumeLinuxLaunchRequest(files.requestPath)
    starting = true
    host.chdir(request.cwd)
    replaceLinuxTarget(argv,{...request,cwd:host.cwd()},execve)
  } catch (error) {
    host.exitCode = 127
    writeLinuxStartupError(files,{type:'error',error:failureRecord(error,argv[0],starting)})
  }
}
