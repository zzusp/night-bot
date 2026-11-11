import { readdir, readFile, stat } from 'node:fs/promises'
import { resolve, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

export const expectedPages = [
  'index.html', '404.html', 'reference/index.html',
  ...['getting-started', 'installation', 'configuration', 'channels', 'usage', 'deployment', 'security'].map(name => `guide/${name}.html`)
]
const base = '/night-bot/'
const origin = 'https://zzusp.github.io'

export async function checkSite(directory, pages = expectedPages) {
  const root = resolve(directory)
  const files = []
  async function walk(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const name = resolve(dir, entry.name)
      if (entry.isSymbolicLink()) throw new Error(`Symbolic link is not publishable: ${relative(root, name)}`)
      if (entry.isDirectory()) await walk(name)
      else files.push(relative(root, name).replaceAll('\\', '/'))
    }
  }
  await walk(root)
  const htmlFiles = files.filter(file => file.endsWith('.html')).sort()
  if (JSON.stringify(htmlFiles) !== JSON.stringify([...pages].sort())) {
    throw new Error(`Unexpected public page set: ${htmlFiles.join(', ')}`)
  }
  const forbidden = files.find(file => /(^|\/)(data|backups|node_modules|\.git|\.env|secrets|acceptance|evidence)(\/|$)/i.test(file))
  if (forbidden) throw new Error(`Private or non-site path in publication output: ${forbidden}`)
  const rootAssets = new Set(['favicon.svg', 'vp-icons.css', 'sitemap.xml', 'hashmap.json'])
  const unexpected = files.find(file => !pages.includes(file) && !rootAssets.has(file) &&
    !/^assets\/(?:chunks\/)?[^/]+\.[A-Za-z0-9_-]{8}(?:\.lean)?\.(?:js|css|woff2)$/.test(file))
  if (unexpected) throw new Error(`Unexpected public asset: ${unexpected}`)
  const contents = new Map(await Promise.all(htmlFiles.map(async file => [file, await readFile(resolve(root, file), 'utf8')])))
  let checked = 0
  for (const [file, html] of contents) {
    if (!/<html[^>]+lang="zh-CN"/.test(html)) throw new Error(`Missing Chinese document language: ${file}`)
    if (!/<title>[^<]+<\/title>/.test(html)) throw new Error(`Missing title: ${file}`)
    for (const match of html.matchAll(/\b(?:href|src)="([^"]+)"/g)) {
      const raw = match[1].replaceAll('&amp;', '&')
      const url = new URL(raw, `${origin}${base}${file}`)
      if (url.origin !== origin) continue
      if (!url.pathname.startsWith(base)) throw new Error(`Link escapes Pages base: ${file} → ${raw}`)
      let target = decodeURIComponent(url.pathname.slice(base.length))
      if (!target || target.endsWith('/')) target += 'index.html'
      const local = resolve(root, target)
      if (relative(root, local).startsWith('..')) throw new Error(`Link escapes output: ${raw}`)
      try { if (!(await stat(local)).isFile()) throw new Error('not a file') }
      catch { throw new Error(`Broken local link: ${file} → ${raw}`) }
      if (url.hash && contents.has(target)) {
        const id = decodeURIComponent(url.hash.slice(1))
        if (!contents.get(target).includes(`id="${id}"`)) throw new Error(`Broken anchor: ${file} → ${raw}`)
      }
      checked++
    }
  }
  return { pages: htmlFiles.length, files: files.length, checkedLocalLinks: checked, base }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const directory = resolve(fileURLToPath(new URL('../.vitepress/dist', import.meta.url)))
  console.log(JSON.stringify(await checkSite(directory), null, 2))
}
