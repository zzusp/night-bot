import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'

const source = name => readFileSync(new URL(`../src/${name}`, import.meta.url), 'utf8')

test('list and settings pages start with working content instead of duplicate headings', () => {
  for (const name of ['TasksPage.tsx', 'EvolutionPage.tsx', 'SettingsPage.tsx']) {
    assert.doesNotMatch(source(name), /className="page-heading"/)
  }
  assert.doesNotMatch(source('EvolutionPage.tsx'), /整个 Bot 共用一套记忆与 Skills/)
  assert.doesNotMatch(source('SettingsPage.tsx'), /设置由安装操作者管理。密钥不回显/)
})

test('refresh actions remain in their relevant list and configuration controls', () => {
  assert.match(source('EvolutionPage.tsx'), /className="evolution-list-toolbar"[\s\S]+<EvolutionListActions [^>]+onRefresh=\{refreshList\}/)
  assert.match(source('EvolutionPage.tsx'), /className="evolution-list-actions"[\s\S]+onClick=\{onRefresh\}>刷新记录/)
  assert.match(source('SettingsPage.tsx'), /className="settings-card-heading"[^\n]+onClick=\{onReload\}[^\n]+重新读取设置/)
  assert.match(source('SettingsPage.tsx'), /const reload=\(\)=>\{if\(busyRoles\)return;/)
  assert.match(source('SettingsPage.tsx'), /onReload=\{reload\} reloading=\{query.loading\|\|busyRoles\}/)
  assert.match(source('TasksPage.tsx'), /<Pagination offset=\{offset\} total=\{query.data.total\}/)
})

test('navigation and detail identity remain; first content sections follow the page h1', () => {
  assert.match(source('App.tsx'), /<h1 ref=\{titleRef\} tabIndex=\{-1\}>\{title\}<\/h1>/)
  assert.match(source('components/TaskOverview.tsx'), /<h2(?:\s[^>]*)?>\{task.title \|\| '未命名任务'\}<\/h2>/)
  assert.match(source('EvolutionPage.tsx'), /<nav className="filter-tabs" aria-label="自进化记录类型"/)
  assert.match(source('SettingsPage.tsx'), /<h2>助手外观<\/h2>/)
  assert.match(source('components/SecretEditor.tsx'), /新的\{label\}/)
})


test('task rail has no classification tabs and preserves primary transcript, preserving primary transcript', () => {
  assert.doesNotMatch(source('TasksPage.tsx'), /task-title-dock|task-records-heading|全部任务|task-info-nav|TaskExecutionDetails|LearningChanges|useRoute|recordControls/)
  assert.match(source('TasksPage.tsx'), /<TaskOverview task=\{task\} \/><div ref=\{setTokenTarget\} \/><TaskLearningSummary key=\{id\} taskId=\{id\} \/>/)
  assert.match(source('TasksPage.tsx'), /controlsTarget=\{null\}/)
})
