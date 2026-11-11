import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync, existsSync} from 'node:fs'
import {registerHooks} from 'node:module'
import {fileURLToPath} from 'node:url'
import ts from 'typescript'
import {createElement} from 'react'
import {renderToStaticMarkup} from 'react-dom/server'

// Render the real TSX component in Node; browser layout/interaction stays in Playwright.
const hooks = registerHooks({
  resolve(specifier, context, next) {
    if (specifier.startsWith('.') && context.parentURL?.startsWith('file:')) {
      const url = new URL(specifier, context.parentURL)
      for (const extension of ['.ts', '.tsx']) {
        if (existsSync(fileURLToPath(url) + extension)) return next(url.href + extension, context)
      }
    }
    return next(specifier, context)
  },
  load(url, context, next) {
    if (url.endsWith('.css')) return {format: 'module', source: '', shortCircuit: true}
    if (/\.tsx?$/.test(url) && url.startsWith('file:')) {
      const source = ts.transpileModule(readFileSync(new URL(url), 'utf8'), {
        fileName: fileURLToPath(url), compilerOptions: {module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022},
      }).outputText
      return {format: 'module', source, shortCircuit: true}
    }
    return next(url, context)
  },
})
let UsageSummary, EvolutionListActions
try { ({UsageSummary, EvolutionListActions} = await import('../src/EvolutionPage.tsx')) } finally { hooks.deregister() }

const data = {
  memory: {acceptedCount: 6, candidateCount: 0, readCount: null, searchCount: null, trackingStatus: 'degraded', lastUsedAt: '2026-11-10T01:00:00Z'},
  skills: {installedCount: 11, modelUseCount: 1, userUseCount: null, fileReadCount: 5, activeCount: 3, trackingStatus: 'degraded', callTrackingSince: '2026-11-10T01:00:00Z'},
}
const render = value => renderToStaticMarkup(createElement(UsageSummary, {data: value}))

test('summary restores both cards and only the eight metrics outside the screenshot red boxes', () => {
  const html = render(data)
  assert.equal((html.match(/class="evolution-card"/g) || []).length, 2)
  assert.deepEqual([...html.matchAll(/<h2[^>]*>(.*?)<\/h2>/g)].map(match => match[1]), ['记忆', 'Skills'])
  assert.deepEqual([...html.matchAll(/<dt>(.*?)<\/dt>/g)].map(match => match[1]), ['已应用', '候选', '读取次数', '搜索次数', '目录技能', '模型 Skill 调用', '用户显式引用', '技能文件读取'])
  assert.deepEqual([...html.matchAll(/<dd>(.*?)<\/dd>/g)].map(match => match[1]), ['6', '0', '未记录', '未记录', '11', '1', '未记录', '5'])
  assert.doesNotMatch(html, /<p[\s>]|<details|查询范围与口径|部分会话记录|最近使用|目录可用|可核验调用|资源准备/)
})

test('summary keeps missing values distinct from recorded zeros', () => {
  const empty = render({memory: {}, skills: {}})
  assert.equal((empty.match(/<dd>未记录<\/dd>/g) || []).length, 8)
  const zero = render({memory: {acceptedCount: 0, candidateCount: 0, readCount: 0, searchCount: 0}, skills: {installedCount: 0, modelUseCount: 0, userUseCount: 0, fileReadCount: 0}})
  assert.equal((zero.match(/<dd>0<\/dd>/g) || []).length, 8)
})

const renderActions = (cache, loading = false) => renderToStaticMarkup(createElement(EvolutionListActions, {cache, loading, onRefresh() {}}))
const cache = {updatedAt: '2026-11-11T15:05:00Z', stale: false, refreshing: false}

test('snapshot time is rendered immediately before the canonical refresh button, without warning semantics', () => {
  const html = renderActions(cache)
  assert.match(html, /^<div class="evolution-list-actions"><p class="evolution-list-updated" role="status">最近更新 /)
  assert.match(html, /<\/p><button [^>]*class="board-button board-button--ghost"/)
  assert.match(html, /刷新记录/)
  assert.doesNotMatch(html, /data-stale|disabled|旧快照|evolution-list-notice/)
})

test('stale snapshot retains real time, refresh status and warning semantics', () => {
  const pending = renderActions({...cache, stale: true, refreshing: true})
  assert.match(pending, /data-stale="true" role="status">旧快照 · .* · 更新中<\/p>/)
  assert.doesNotMatch(pending, /最近更新 /)
  const failed = renderActions({...cache, stale: true})
  assert.match(failed, /data-stale="true"/)
  assert.match(failed, /更新未完成/)
})

test('missing or invalid snapshot times are never replaced with the current time and refresh stays a native busy control', () => {
  const missing = renderActions(undefined)
  assert.doesNotMatch(missing, /evolution-list-updated|最近更新|role="status"/)
  assert.match(missing, /刷新记录/)
  for (const updatedAt of [null, 'invalid']) assert.match(renderActions({...cache, updatedAt}), /最近更新 未记录/)
  const loading = renderActions(cache, true)
  assert.match(loading, /最近更新 /)
  assert.match(loading, /<button [^>]*disabled="" aria-busy="true"/)
})

test('timestamp styles reuse theme tokens while keeping the refresh button and warnings distinct', () => {
  const css = readFileSync(new URL('../src/styles/evolution.css', import.meta.url), 'utf8')
  assert.match(css, /\.evolution-list-updated \{[^}]*color: var\(--board-muted\)/)
  assert.match(css, /\.evolution-list-updated\[data-stale\] \{ color: var\(--board-warning\)/)
  assert.match(css, /\.evolution-list-actions > \.board-button \{ flex-shrink: 0; \}/)
  assert.match(css, /\.evolution-list-notice \{[^}]*color: var\(--board-warning\)/)
})
