import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { checkSite, checkPublicSource } from './check-site.mjs'

const page = body => `<html lang="zh-CN"><head><title>Night Bot</title></head><body>${body}</body></html>`
async function fixture(t, files) {
  const root = await mkdtemp(join(tmpdir(), 'night-bot-site-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  for (const [path, text] of Object.entries(files)) {
    await mkdir(join(root, path, '..'), { recursive: true })
    await writeFile(join(root, path), text)
  }
  return root
}
test('accepts base-prefixed links, local assets, anchors and external sources', async t => {
  const root = await fixture(t, { 'index.html': page('<h1 id="start">开始</h1><a href="/night-bot/#start">开始</a><img src="/night-bot/favicon.svg"><a href="https://github.com/zzusp/night-bot">GitHub</a>'), 'favicon.svg': '<svg/>' })
  assert.equal((await checkSite(root, ['index.html'])).checkedLocalLinks, 2)
})
test('rejects links outside project base', async t => {
  const root = await fixture(t, { 'index.html': page('<a href="/guide/start.html">开始</a>') })
  await assert.rejects(checkSite(root, ['index.html']), /escapes Pages base/)
})
test('rejects missing files and headings', async t => {
  const root = await fixture(t, { 'index.html': page('<a href="/night-bot/missing.html">缺失</a>') })
  await assert.rejects(checkSite(root, ['index.html']), /Broken local link/)
  await writeFile(join(root, 'index.html'), page('<a href="#missing">缺失</a>'))
  await assert.rejects(checkSite(root, ['index.html']), /Broken anchor/)
})
test('rejects unintended extra pages', async t => {
  const root = await fixture(t, { 'index.html': page('首页'), 'private.html': page('不能发布') })
  await assert.rejects(checkSite(root, ['index.html']), /Unexpected public page set/)
})
test('rejects non-site paths even when not linked', async t => {
  const root = await fixture(t, { 'index.html': page('首页'), 'data/config.json': '{}' })
  await assert.rejects(checkSite(root, ['index.html']), /Private or non-site path/)
})

for (const file of ['runtime.log', 'config.json', 'backup.zip', '.env.local', 'assets/runtime.log', 'assets/private.js']) {
  test(`rejects unapproved public asset: ${file}`, async t => {
    const root = await fixture(t, { 'index.html': page('首页'), [file]: 'private fixture' })
    await assert.rejects(checkSite(root, ['index.html']), /Unexpected public asset/)
  })
}

test('public source accepts only the explicitly reviewed favicon', async t => {
  const root = await fixture(t, { 'favicon.svg': '<svg/>' })
  await checkPublicSource(root)
  await writeFile(join(root, 'private.ABCD1234.js'), 'private fixture')
  await assert.rejects(checkPublicSource(root), /Public source allows only/)
})
