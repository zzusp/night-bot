// Retained task metadata helpers. The former Owner/leaf Session driver is retired.
import {createHash} from 'node:crypto'
import {stat} from 'node:fs/promises'
import path from 'node:path'

export async function taskWorkLocations(task) {
  const previous = task.runHistory?.at(-1)
  const sources = [
    ...(task.localWorktrees ?? []).filter(item => item.status === 'registered').map(item => ({ text: item.path, source: 'task.localWorktrees' })),
    ...(task.localWorktrees ?? []).flatMap(item => (item.documents ?? []).filter(document => document.archivePath).map(document => ({ text: document.archivePath, source: 'task.localWorktrees.documents' }))),
    ...(task.result?.artifacts ?? []).map(text => ({ text, source: 'result.artifacts' })),
    ...(task.lastWaitingResult?.artifacts ?? []).map(text => ({ text, source: 'lastWaitingResult.artifacts' })),
    ...[...(task.checkpoints ?? []), ...(previous?.checkpoints ?? [])].flatMap(item =>
      (item.evidence ?? []).map(text => ({ text, source: `checkpoint:${item.checkpointId ?? 'history'}` }))),
    ...(previous?.result?.artifacts ?? []).map(text => ({ text, source: 'previousRun.result.artifacts' })),
    ...[task.reopenContext, task.resumeContext].filter(Boolean).map(text => ({ text, source: 'handoff' })),
  ]
  const candidates = new Map()
  for (const { text, source } of sources) {
    const values = [String(text).trim(), ...String(text).matchAll(/`([^`\r\n]+)`|\]\(([^)\r\n]+)\)|([A-Za-z]:[\\/][^\s`<>"'，；。)]+)/gu)]
    for (const value of values) {
      const candidate = (typeof value === 'string' ? value : value[1] ?? value[2] ?? value[3]).replace(/^<|>$/gu, '')
      if (path.isAbsolute(candidate) && !candidate.startsWith('\\\\')) candidates.set(path.normalize(candidate), source)
    }
  }
  const locations = new Map()
  const add = async (file, source, kind) => {
    const info = await stat(file).catch(() => undefined)
    if (!info?.isFile() && !info?.isDirectory()) return
    locations.set(file, { path: file, kind: kind ?? (info.isDirectory() ? 'directory' : path.basename(file) === 'goal.md' ? 'goal' : 'artifact'), source })
  }
  for (const [file, source] of [...candidates].slice(0, 24)) {
    await add(file, source)
    if (!locations.has(file)) continue
    const normalized = file.split(path.sep).join('/')
    const match = normalized.match(/^(.*)\/docs\/acceptance\/([^/]+)(?:\/|$)/u)
    if (match) {
      await add(path.normalize(`${match[1]}/docs/acceptance/${match[2]}`), source, 'acceptance')
      const marker = await stat(path.join(match[1], '.git')).catch(() => undefined)
      if (marker) await add(path.normalize(match[1]), source, marker.isFile() ? 'worktree' : 'repository')
    }
  }
  return { status: locations.size ? 'verified' : 'unknown', locations: [...locations.values()], unchecked: Math.max(0, candidates.size - 24),
    guidance: '仅为已记录路径的当前存在性核验，不代表授权或历史结果仍有效。优先从这些位置读取；位置未知时读取现有任务工件或询问缺失位置，不要重新扫描整个工作区。' }
}
const compactText = (value, limit) => {
  const text = String(value ?? '').trim()
  return text.length <= limit ? text : `${text.slice(0, limit)}…`
}
export const buildTaskAssociationIndex = (tasks) => tasks.map((task) => ({
  taskId: task.taskId,
  ...(task.title ? { title: compactText(task.title, 120) } : {}),
  objectiveExcerpt: compactText(task.objective, 120),
  state: task.state,
  archived: Boolean(task.archivedAt),
  topicRefs: task.topicRefs, inputVersion: task.inputVersion, runSequence: task.runSequence,
}))
export const residentSessionId = (groupId) => `session-group-${createHash('sha256').update(groupId).digest('hex').slice(0, 24)}`
