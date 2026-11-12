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
let UsageSummary, EvolutionListActions, EvolutionEntryList, EvolutionEntryMetadata, Pagination
try {
  ({UsageSummary, EvolutionListActions} = await import('../src/EvolutionPage.tsx'))
  ;({default: EvolutionEntryList, EvolutionEntryMetadata} = await import('../src/components/EvolutionEntryList.tsx'))
  ;({Pagination} = await import('../src/components/Shared.tsx'))
} finally { hooks.deregister() }

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

const renderActions = (cache, loading = false, sessionsRead = 26) => renderToStaticMarkup(createElement(EvolutionListActions, {cache, sessionsRead, loading, onRefresh() {}}))
const cache = {updatedAt: '2026-11-11T15:05:00Z', stale: false, refreshing: false}

test('snapshot time is rendered immediately before the canonical refresh button, without warning semantics', () => {
  const html = renderActions(cache)
  assert.match(html, /^<div class="evolution-list-actions"><p class="evolution-list-updated" role="status">最近更新 /)
  assert.match(html, /<\/p><button [^>]*class="board-button board-button--ghost"/)
  assert.match(html, /刷新记录/)
  assert.match(html, / · 已统计 26 个会话<\/p>/)
  assert.doesNotMatch(html, /data-stale|disabled|旧快照|evolution-list-notice/)
})

test('stale snapshot retains real time, refresh status and warning semantics', () => {
  const pending = renderActions({...cache, stale: true, refreshing: true})
  assert.match(pending, /data-stale="true" role="status">旧快照 · .* · 更新中 · 已统计 26 个会话<\/p>/)
  assert.doesNotMatch(pending, /最近更新 /)
  const failed = renderActions({...cache, stale: true})
  assert.match(failed, /data-stale="true"/)
  assert.match(failed, /更新未完成/)
})

test('missing or invalid snapshot times are never replaced with the current time and refresh stays a native busy control', () => {
  const missing = renderActions(undefined, false, null)
  assert.doesNotMatch(missing, /evolution-list-updated|最近更新|role="status"/)
  assert.match(missing, /刷新记录/)
  for (const updatedAt of [null, 'invalid']) assert.match(renderActions({...cache, updatedAt}), /最近更新 未记录/)
  const loading = renderActions(cache, true)
  assert.match(loading, /最近更新 /)
  assert.match(loading, /<button [^>]*disabled="" aria-busy="true"/)
})

test('session scope is the recorded count, with zero and missing values kept distinct', () => {
  assert.match(renderActions(cache, false, 0), /已统计 0 个会话/)
  assert.match(renderActions(cache, false, 1234), /已统计 1,234 个会话/)
  for (const value of [null, -1, 1.5, NaN, Infinity, '26', Number.MAX_SAFE_INTEGER + 1]) {
    const html = renderActions(cache, false, value)
    assert.match(html, /统计会话数未记录/)
    assert.doesNotMatch(html, /已统计 \d|全部|完整覆盖/)
  }
  assert.match(renderActions(undefined), /role="status">已统计 26 个会话<\/p>/)
  assert.doesNotMatch(renderActions(undefined), /最近更新/)
})

test('entry totals sum only observed valid counts without incomplete or lower-bound labels', () => {
  const base = {kind: 'skill', name: '合成技能', scope: 'bot', status: 'applied', revision: 1}
  const values = [[2, 1, 4], [2, null, 3], [0, 0, 0], [null, null, null], [-1, '2', null], [Number.MAX_SAFE_INTEGER, 1, 0]]
  const items = values.map(([modelUseCount, userUseCount, fileReadCount], id) => ({...base, id: String(id), modelUseCount, userUseCount, fileReadCount}))
  items.push({...base, id: 'memory', kind: 'memory', memoryUse: {readCount: 3, searchCount: null}})
  const html = renderToStaticMarkup(createElement(EvolutionEntryList, {items, onView() {}}))
  const totals = [...html.matchAll(/class="evolution-usage-cell"><span[^>]*>使用次数<\/span><span>(.*?)<\/span>/g)].map(match => match[1])
  assert.deepEqual(totals, ['7', '5', '0', '未记录', '未记录', '未记录', '3'])
  assert.doesNotMatch(html, /记录不完整|至少|evolution-count-status/)
  assert.match(html, /仅统计已核查会话中的有效记录/)
  const details = renderToStaticMarkup(createElement(EvolutionEntryMetadata, {item: {...base, id: 'mixed', modelUseCount: 2, userUseCount: -1, fileReadCount: NaN}}))
  assert.equal((details.match(/<abbr title="未记录">—<\/abbr>/g) || []).length, 2)
  assert.doesNotMatch(details, />NaN<|>-1</)
})

test('timestamp styles reuse theme tokens while keeping the refresh button and warnings distinct', () => {
  const css = readFileSync(new URL('../src/styles/evolution.css', import.meta.url), 'utf8')
  assert.match(css, /\.evolution-list-updated \{[^}]*color: var\(--board-muted\)/)
  assert.match(css, /\.evolution-list-updated\[data-stale\] \{ color: var\(--board-warning\)/)
  assert.match(css, /\.evolution-list-actions > \.board-button \{ flex-shrink: 0; \}/)
  assert.match(css, /\.evolution-list-notice \{[^}]*color: var\(--board-warning\)/)
})

for (const kind of ['memory', 'skill']) test(`${kind} detail arrow belongs to the final cell, after all metadata`, () => {
  const html = renderToStaticMarkup(createElement(EvolutionEntryList, {items: [{id:'x', name:'Example', kind, status:'applied', revision:1}], onView() {}}))
  assert.match(html, /evolution-updated-cell[\s\S]*evolution-action-cell[\s\S]*查看详情：Example[\s\S]*<\/td><\/tr>/)
  assert.equal((html.match(/evolution-item-arrow/g) || []).length, 1)
})
test('evolution ten-row pagination keeps shared twenty-row default unchanged', () => {
  const props = {offset:10,total:23,nextOffset:20,onPage(){},pageSize:10}
  assert.match(renderToStaticMarkup(createElement(Pagination, props)), /第 2 页/)
  assert.match(renderToStaticMarkup(createElement(Pagination, {...props,offset:20,pageSize:undefined})), /第 2 页/)
})
