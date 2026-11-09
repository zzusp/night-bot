import { spawn } from 'node:child_process'

function lineReader(stream, onLine) {
  let buffer = ''
  stream.setEncoding('utf8')
  stream.on('data', (chunk) => {
    buffer += chunk
    const lines = buffer.split(/\r?\n/)
    buffer = lines.pop() ?? ''
    for (const line of lines) if (line !== '') onLine(line)
  })
  stream.on('end', () => { if (buffer !== '') onLine(buffer) })
}

export function createNodeDwsRunner({ executable = 'dws', cwd = process.cwd(), runTimeoutMs = 30_000,env } = {}) {
  return {
    cwd,
    spawn(args, hooks = {}) {
      const child = spawn(executable, args, { cwd,...env?{env}:{}, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
      lineReader(child.stdout, hooks.onStdoutLine ?? (() => undefined))
      lineReader(child.stderr, hooks.onStderrLine ?? (() => undefined))
      const done = new Promise((resolve, reject) => {
        child.once('error', reject)
        child.once('exit', (exitCode, signal) => resolve({ exitCode, signal }))
      })
      const closed = new Promise(resolve => child.once('close', resolve))
      return { done, waitForExit: () => closed, terminate(signal = 'SIGTERM') { return child.kill(signal) } }
    },
    async run(args) {
      const stdout = []
      const stderr = []
      const child = this.spawn(args, { onStdoutLine: (line) => stdout.push(line), onStderrLine: (line) => stderr.push(line) })
      let timer, result
      const timeoutError = new Error(`dws_command_timeout:${runTimeoutMs}`)
      const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(timeoutError), runTimeoutMs); timer.unref?.() })
      try { result = await Promise.race([child.done, timeout]) }
      catch (error) {
        const failures = [error]
        for (const signal of ['SIGTERM', 'SIGKILL']) {
          try { child.terminate(signal) } catch (cause) { failures.push(cause) }
        }
        if (failures.length > 1) throw new AggregateError(failures, error.message)
        throw error
      } finally {
        clearTimeout(timer)
        // 发出终止请求不等于退出；调用方保留所有权，直到进程及管道实际关闭。
        await child.waitForExit()
      }
      return { ...result, stdout: stdout.join('\n'), stderr: stderr.join('\n') }
    },
  }
}
