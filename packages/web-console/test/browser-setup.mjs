import {access} from 'node:fs/promises'
import {startPreview} from './preview.mjs'

export default async function setup() {
  await access(new URL('../dist/index.html', import.meta.url))
  // 同一 runner 持有服务，测试成功或失败都关闭 SQLite 并清理本轮临时目录。
  // 避免 Windows 强制终止 webServer 子进程时跳过它的信号清理。
  const fixture = await startPreview({port: 3081})
  return () => fixture.close()
}
